-- 0038_cron_rpc_tenant_scope
-- OWASP 스캔 A01(medium, 대시보드 #7): 크론 DEFINER RPC가 invoices→clients/contracts를
-- 조인하면서 테넌트 일치(c.user_id = i.user_id)를 확인하지 않는다. DEFINER는 RLS를 우회하므로,
-- 공격자가 client_id를 피해자 소유 UUID로 지정한 자기 인보이스를 만들어 두면 일일 크론이
-- 피해자의 클라이언트명·계약 제목을 읽어 공격자 소유 독촉 초안에 실어 준다(타 테넌트 PII 유입).
--
-- 두 층에서 막는다:
--   1) DEFINER RPC 조인에 테넌트 일치 조건 (여기서 fail-closed)
--   2) 근본 원인인 FK 참조 — invoices·recurring_invoices INSERT/UPDATE 정책 WITH CHECK에
--      부모(client·contract) 소유권 검사를 추가해 애초에 남의 리소스를 참조하지 못하게 한다.
--      (FK 자체는 RLS를 우회하므로 정책에서 막아야 한다 — CLAUDE.md 데이터 규칙)
--
-- 함께 고치는 회귀: 0034가 0031의 `u.email::text` 캐스팅을 빠뜨려 원격(auth.users.email이
-- varchar(255))에서 "structure of query does not match function result type"로 스윕 전체가
-- 실패한다. 0031이 고쳤던 것과 같은 결함이라 캐스팅을 되살린다.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 독촉 초안 후보 — 0034(플랜 게이트·배치 상한) 유지 + 테넌트 조인 + email 캐스팅
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function create_dunning_drafts_for_overdue(
  p_cron_secret text,
  p_cooldown_days integer default 7
)
returns table (
  reminder_id uuid,
  user_id uuid,
  invoice_id uuid,
  client_name text,
  client_email text,
  contract_title text,
  net_amount bigint,
  due_date date,
  days_overdue integer,
  freelancer_name text,
  owner_email text
)
language plpgsql
security definer
as $$
-- RETURNS TABLE의 OUT 변수명(user_id·invoice_id 등)이 쿼리 컬럼명과 겹치므로 컬럼 우선 해석.
#variable_conflict use_column
declare
  c_max_per_user constant integer := 20;
  c_max_per_run constant integer := 200;
begin
  perform assert_cron_secret(p_cron_secret);

  return query
  with eligible as (
    select
      i.id as invoice_id,
      i.user_id as user_id,
      c.name as client_name,
      c.contact_email as client_email,
      coalesce(ct.title, i.contract_snapshot->>'title', '(제목 없음)') as contract_title,
      i.net_amount as net_amount,
      i.due_date as due_date,
      (current_date - i.due_date)::integer as days_overdue,
      p.display_name as freelancer_name,
      -- auth.users.email은 varchar(255)이므로 RETURNS TABLE의 text와 맞추려면 캐스팅 필요(0031).
      u.email::text as owner_email
    from invoices i
    -- 테넌트 일치: 남의 클라이언트를 참조하는 인보이스는 후보에서 제외(조인에서 탈락).
    join clients c on c.id = i.client_id and c.user_id = i.user_id
    left join contracts ct on ct.id = i.contract_id and ct.user_id = i.user_id
    left join profiles p on p.user_id = i.user_id
    join auth.users u on u.id = i.user_id
    where i.payment_status = 'unpaid'
      and i.due_date < current_date
      and i.deleted_at is null
      -- Pro 게이트: derivePlan(lib/plan.ts)과 같은 규칙으로 유효 pro만 통과시킨다.
      and exists (
        select 1
        from subscriptions s
        where s.user_id = i.user_id
          and s.plan = 'pro'
          and s.status <> 'revoked'
          and (s.current_period_end is null or s.current_period_end > now())
      )
      and not exists (
        select 1 from dunning_reminders d
        where d.invoice_id = i.id and d.status = 'pending_review'
      )
      and not exists (
        select 1 from dunning_reminders d
        where d.invoice_id = i.id
          and d.status = 'sent'
          and d.sent_at > now() - make_interval(days => p_cooldown_days)
      )
  ),
  -- 사용자당 상한: 한 계정의 연체 더미가 실행 전체를 잡아먹지 않게 한다.
  ranked as (
    select
      e.*,
      row_number() over (partition by e.user_id order by e.due_date, e.invoice_id) as user_rank
    from eligible e
  ),
  -- 실행당 상한: 오래 밀린 건부터. 잘린 후보는 다음 실행에서 다시 잡힌다.
  candidates as (
    select r.*
    from ranked r
    where r.user_rank <= c_max_per_user
    order by r.due_date, r.invoice_id
    limit c_max_per_run
  ),
  inserted as (
    insert into dunning_reminders (user_id, invoice_id)
    select cand.user_id, cand.invoice_id from candidates cand
    returning id, invoice_id
  )
  select
    ins.id,
    cand.user_id,
    cand.invoice_id,
    cand.client_name,
    cand.client_email,
    cand.contract_title,
    cand.net_amount,
    cand.due_date,
    cand.days_overdue,
    cand.freelancer_name,
    cand.owner_email
  from inserted ins
  join candidates cand on cand.invoice_id = ins.invoice_id;
end;
$$;

alter function create_dunning_drafts_for_overdue(text, integer)
  set search_path = public, pg_temp;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 반복 인보이스 생성 — 0029 유지 + 스케줄의 부모(client·contract) 테넌트 일치
--    남의 client_id를 가리키는 스케줄은 draft 인보이스를 만들지 않는다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function generate_due_recurring_invoices(p_cron_secret text)
returns table (
  invoice_id uuid,
  user_id uuid,
  owner_email text
)
language plpgsql
security definer
as $$
declare
  v_rec record;
  v_invoice_id uuid;
  v_next_run date;
begin
  perform assert_cron_secret(p_cron_secret);

  for v_rec in
    select r.*, u.email::text as owner_email
    from recurring_invoices r
    join auth.users u on u.id = r.user_id
    where r.active
      and r.next_run_at <= current_date
      -- 테넌트 일치: 남의 클라이언트·계약을 참조하는 스케줄은 건너뛴다.
      and exists (
        select 1 from clients c
        where c.id = r.client_id and c.user_id = r.user_id
      )
      and (
        r.contract_id is null
        or exists (
          select 1 from contracts ct
          where ct.id = r.contract_id and ct.user_id = r.user_id
        )
      )
      and exists (
        select 1 from subscriptions s
        where s.user_id = r.user_id
          and s.plan = 'pro'
          and s.status <> 'revoked'
          and (s.current_period_end is null or s.current_period_end > now())
      )
  loop
    -- draft 인보이스 생성(세금은 스케줄 스냅샷 순수 복사).
    insert into invoices (
      user_id, contract_id, client_id, amount, issue_date, due_date,
      withholding_type, withholding_amount, net_amount, payment_status
    )
    values (
      v_rec.user_id, v_rec.contract_id, v_rec.client_id, v_rec.amount,
      current_date, current_date + v_rec.due_offset_days,
      v_rec.withholding_type, v_rec.withholding_amount, v_rec.net_amount, 'draft'
    )
    returning id into v_invoice_id;

    insert into invoice_events (
      user_id, invoice_id, actor, from_status, to_status, event_type, meta
    )
    values (
      v_rec.user_id, v_invoice_id, 'cron:recurring', null, 'draft',
      'invoice.draft_generated',
      jsonb_build_object('recurring_id', v_rec.id)
    );

    -- next_run_at 전진(schedule.ts computeNextRun과 등가: weekly=+7d, monthly=+1month 월말 클램프).
    if v_rec.interval_kind = 'weekly' then
      v_next_run := v_rec.next_run_at + 7;
    else
      v_next_run := (v_rec.next_run_at + interval '1 month')::date;
    end if;

    update recurring_invoices
    set next_run_at = v_next_run,
        last_generated_at = now()
    where id = v_rec.id;

    invoice_id := v_invoice_id;
    user_id := v_rec.user_id;
    owner_email := v_rec.owner_email;
    return next;
  end loop;
end;
$$;

alter function generate_due_recurring_invoices(text)
  set search_path = public, pg_temp;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) FK 참조 소유권 — 정책 WITH CHECK에 부모 소유권 검사 추가
--    USING(어느 행을 볼/고칠 수 있나)은 그대로 두고, WITH CHECK(어떤 값으로 남길 수 있나)만
--    좁힌다. 하위 select는 호출자 권한이라 clients/contracts의 select 정책이 그대로 적용된다.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "invoices_insert_own" on invoices;
create policy "invoices_insert_own"
  on invoices
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from clients c
      where c.id = client_id and c.user_id = (select auth.uid())
    )
    and (
      contract_id is null
      or exists (
        select 1 from contracts ct
        where ct.id = contract_id and ct.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "invoices_update_own" on invoices;
create policy "invoices_update_own"
  on invoices
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from clients c
      where c.id = client_id and c.user_id = (select auth.uid())
    )
    and (
      contract_id is null
      or exists (
        select 1 from contracts ct
        where ct.id = contract_id and ct.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "recurring_invoices_insert_own" on recurring_invoices;
create policy "recurring_invoices_insert_own"
  on recurring_invoices
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from clients c
      where c.id = client_id and c.user_id = (select auth.uid())
    )
    and (
      contract_id is null
      or exists (
        select 1 from contracts ct
        where ct.id = contract_id and ct.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "recurring_invoices_update_own" on recurring_invoices;
create policy "recurring_invoices_update_own"
  on recurring_invoices
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from clients c
      where c.id = client_id and c.user_id = (select auth.uid())
    )
    and (
      contract_id is null
      or exists (
        select 1 from contracts ct
        where ct.id = contract_id and ct.user_id = (select auth.uid())
      )
    )
  );

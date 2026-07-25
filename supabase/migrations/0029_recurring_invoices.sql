-- 0029_recurring_invoices
-- 반복(구독형) 인보이스. 매 주기 draft 인보이스를 자동 생성하고 소유자가 검토 후 발행한다(반자동).
-- 스케줄 CRUD는 세션 있는 Server Action(RLS own). 세션 없는 크론의 생성은 0027 assert_cron_secret
-- 게이트를 통과한 SECURITY DEFINER RPC에서만. 세금은 스케줄 생성 시 calcWithholding으로 스냅샷
-- 저장하고 RPC는 순수 복사만 한다(SQL에 세금 로직 중복 금지).
-- 다운그레이드 정책: RPC의 plan=pro 조건이 free 유저 스케줄을 자동 건너뜀(생성 일시중지, 데이터 보존).

create table recurring_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contract_id uuid references contracts (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  amount bigint not null check (amount > 0),
  withholding_type withholding_type not null,
  withholding_amount bigint not null,
  net_amount bigint not null,
  interval_kind text not null check (interval_kind in ('weekly', 'monthly')),
  next_run_at date not null,
  due_offset_days integer not null default 14 check (due_offset_days >= 0),
  active boolean not null default true,
  last_generated_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index recurring_invoices_user_created_idx
  on recurring_invoices (user_id, created_at);
create index recurring_invoices_due_idx
  on recurring_invoices (next_run_at)
  where active;

alter table recurring_invoices enable row level security;

create policy "recurring_invoices_select_own"
  on recurring_invoices
  for select
  using (user_id = (select auth.uid()));

create policy "recurring_invoices_insert_own"
  on recurring_invoices
  for insert
  with check (user_id = (select auth.uid()));

create policy "recurring_invoices_update_own"
  on recurring_invoices
  for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "recurring_invoices_delete_own"
  on recurring_invoices
  for delete
  using (user_id = (select auth.uid()));

-- 오늘 도래한 활성 스케줄(소유자 plan=pro)마다 draft 인보이스를 생성하고 next_run_at을 전진한다.
-- plan 판정은 lib/plan.ts derivePlan과 등가(SQL): pro + status<>revoked + 기간 유효.
-- 반환: sweep이 소유자 알림을 보낼 때 필요한 (생성 인보이스, 소유자 이메일).
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
    select r.*, u.email as owner_email
    from recurring_invoices r
    join auth.users u on u.id = r.user_id
    where r.active
      and r.next_run_at <= current_date
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

revoke all on function generate_due_recurring_invoices(text) from public;
grant execute on function generate_due_recurring_invoices(text) to anon, authenticated;

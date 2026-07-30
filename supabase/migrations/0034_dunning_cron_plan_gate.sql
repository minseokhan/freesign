-- 0034_dunning_cron_plan_gate
-- OWASP 스캔 A06(high, 대시보드 #22): 미수금 독촉 크론에 플랜 게이트도 배치 상한도 없다.
--
-- create_dunning_drafts_for_overdue는 크론 시크릿만 통과하면 RLS 없이 전 테넌트의 연체
-- 인보이스를 후보로 만들고, sweep(src/lib/cron/dunning-sweep.ts)은 후보 1건마다 Claude를
-- 호출한다. 독촉은 Pro 기능인데(ADR-010 · assertProFeature) 크론 경로에는 그 게이트가 없어
-- 무료 사용자가 연체 인보이스를 쌓아두는 것만으로 외부 API 비용을 무제한 유발할 수 있었다.
--
-- 두 가지를 넣는다:
--   1) Pro 게이트 — lib/plan.ts derivePlan과 동일 규칙(행 없음/revoked/plan<>pro/기간 만료 → free)
--   2) 배치 상한 — 사용자당 20건, 실행당 200건. 지급기한이 오래 지난 건부터 처리한다.
--
-- 상한에 걸려 잘린 후보는 다음 실행에서 다시 후보가 된다(초안이 안 만들어졌으므로 조건 유지).
-- 시그니처·반환 타입·나머지 후보 조건은 0028과 동일하며 create or replace라 ACL이 유지된다.

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
      u.email as owner_email
    from invoices i
    join clients c on c.id = i.client_id
    left join contracts ct on ct.id = i.contract_id
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

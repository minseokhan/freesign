-- 0048_account_deletion
-- 회원 탈퇴(계정 즉시 완전 삭제) 경계.
--
-- 왜 SECURITY DEFINER인가: Supabase 표준 경로인 auth.admin.deleteUser()는 service_role
-- 키를 요구하는데, 이 프로젝트는 요청 경로에서 service_role을 금지한다(CLAUDE.md).
-- 세션 있는 경계이므로 시크릿 게이트(ADR-010의 webhook·크론 방식)는 필요 없고,
-- auth.uid()가 곧 인가다. 인자를 하나도 받지 않는 것이 핵심 — 삭제 대상을 클라이언트가
-- 지정할 수 없다.
--
-- 왜 결제 기록만 남기는가: 전자상거래 등에서의 소비자보호에 관한 법률상 대금결제 기록은
-- 5년 보존 의무가 있다. billing_events는 user_id FK(cascade)라 계정과 함께 사라지므로,
-- 삭제 직전에 FK 없는 익명 테이블로 최소 컬럼만 옮긴다.
-- meta jsonb는 어떤 PII가 들어 있는지 보증할 수 없어 이관하지 않는다(화이트리스트).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) billing_records_retained — 탈퇴 후에도 남는 익명 결제 기록.
--    auth.users FK가 없다는 것이 요점이다. 개인 식별자는 담지 않는다.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists billing_records_retained (
  id bigint generated always as identity primary key,
  polar_customer_id text,
  polar_subscription_id text,
  event_type text not null,
  status text,
  occurred_at timestamptz not null,
  retained_at timestamptz not null default now()
);

create index if not exists billing_records_retained_occurred_at_idx
  on billing_records_retained (occurred_at);

alter table billing_records_retained enable row level security;

-- 정책을 하나도 만들지 않는다 = PostgREST로는 누구도 읽고 쓸 수 없다.
-- 법정 보존 목적이므로 운영자가 DB 콘솔로만 열람한다.
revoke all on table billing_records_retained from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) delete_own_account() — 본인 계정 즉시 삭제.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  -- 활성 구독을 남긴 채 계정만 지우면 Polar 쪽 구독이 살아서 결제가 계속된다.
  -- 과금이 이어지는 상태(mapPolarStatusToPlan의 pro 집합)에서는 삭제를 거부하고
  -- 먼저 해지하도록 되돌린다.
  if exists (
    select 1
    from public.subscriptions
    where user_id = v_uid
      and status in ('active', 'trialing', 'past_due')
  ) then
    raise exception 'active_subscription' using errcode = 'P0001';
  end if;

  insert into public.billing_records_retained (
    polar_customer_id,
    polar_subscription_id,
    event_type,
    status,
    occurred_at
  )
  select
    s.polar_customer_id,
    e.polar_subscription_id,
    e.event_type,
    e.status,
    e.created_at
  from public.billing_events e
  left join public.subscriptions s on s.user_id = e.user_id
  where e.user_id = v_uid;

  -- 아래 4줄은 순서가 중요하다. cascade만으로는 실패한다:
  --   * contracts.client_id / invoices.client_id → clients 는 ON DELETE RESTRICT다.
  --     RESTRICT는 같은 문장 안에서 자식이 함께 지워지더라도 즉시 위반으로 판정하므로,
  --     auth.users 하나만 지우면 clients 정리 단계에서 곧바로 에러가 난다.
  --     (RESTRICT 자체는 "계약이 붙은 클라이언트는 못 지운다"는 제품 규칙이라 유지한다.)
  --   * invoice_events.invoice_id → invoices 는 NO ACTION이라 이벤트가 남은 채
  --     인보이스를 지우면 문장 끝 검사에서 걸린다.
  -- 따라서 자식 → 부모 순으로 명시적으로 지운 뒤 계정을 지운다.
  delete from public.invoice_events where user_id = v_uid;
  delete from public.invoices where user_id = v_uid;
  -- contracts를 지우면 contract_events·contract_signatures·signature_requests·
  -- contract_insights·recurring_invoices가 cascade로 함께 정리된다.
  delete from public.contracts where user_id = v_uid;
  delete from public.clients where user_id = v_uid;

  -- 남은 것(profiles·usage_counters·rate_limit_events·subscriptions·billing_events 등)은
  -- 0047이 맞춰 놓은 cascade가 끌고 간다.
  -- auth.sessions·auth.identities 등 Supabase 내부 테이블도 cascade로 정리된다.
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function delete_own_account() from public;
revoke all on function delete_own_account() from anon;
grant execute on function delete_own_account() to authenticated;

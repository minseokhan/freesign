-- 0024_billing
-- 유료화(Polar) 도입: 구독 상태·감사 로그·플랜 게이팅 인프라.
-- 경계: "불러오기 = Free / 새 계약 생성·서명 = Pro" (docs/BILLING_PLAN.md, docs/ADR.md).
--
-- 보안 설계 요지:
--  1) subscriptions: 본인 행 SELECT만 허용(UI 렌더용). INSERT/UPDATE는 클라이언트 직접 금지 —
--     오직 아래 SECURITY DEFINER RPC(webhook 경유)로만 기록한다.
--  2) upsert_subscription_from_polar: Polar webhook은 로그인 세션이 없어 남의 구독 행을 써야 한다.
--     service_role(마스터키)을 요청 경로에 두는 대신 DEFINER RPC로 RLS를 우회하되,
--     anon이 이 RPC를 직접 호출해 남을 pro로 올리는 권한상승을 막기 위해 webhook 시크릿을
--     파라미터로 받아 GUC(app.polar_webhook_secret)와 대조한다. GUC 미설정 시 fail-closed(거부).
--  3) usage_counters/consume_lifetime_quota: 무료 누적 상한(불러오기 파싱 5회). caller 권한 + RLS,
--     user_id는 auth.uid()에서만. consume_rate_limit(0014)와 동일 보안 모델.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) subscriptions — user당 1행. 행 없으면 free로 간주(lib/plan.ts derivePlan).
-- ─────────────────────────────────────────────────────────────────────────────
create table subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'inactive',
  polar_customer_id text,
  polar_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Polar 고객·구독 id로 webhook 재처리 시 행 조회(customer id 기준 upsert 보조).
create index subscriptions_polar_customer_id_idx
  on subscriptions (polar_customer_id);

alter table subscriptions enable row level security;

-- 본인 구독 행만 조회(UI 플랜 배지·게이트 렌더용).
create policy "subscriptions_select_own"
  on subscriptions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- INSERT/UPDATE/DELETE 정책 없음 = 클라이언트 직접 쓰기 전면 차단.
-- 기록은 upsert_subscription_from_polar(DEFINER)로만.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) billing_events — append-only 감사 로그 (contract_events/invoice_events 패턴).
-- ─────────────────────────────────────────────────────────────────────────────
create table billing_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  polar_subscription_id text,
  event_type text not null,
  status text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index billing_events_user_id_created_at_idx
  on billing_events (user_id, created_at);

alter table billing_events enable row level security;

-- 본인 이벤트만 조회. INSERT는 DEFINER RPC 내부에서만(정책 없음 = 직접 쓰기 차단).
create policy "billing_events_select_own"
  on billing_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) usage_counters — 무료 티어 누적 사용량 오도미터(불러오기 파싱 등).
--    사용자·버킷별 누적 카운트. pro는 소비하지 않으므로 무료 사용분만 누적된다.
--    → 다운그레이드 후에도 무료 시절 소비분이 그대로 남아 "누적 N회" 의미가 유지된다.
-- ─────────────────────────────────────────────────────────────────────────────
create table usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null,
  used integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket)
);

alter table usage_counters enable row level security;

-- consume_lifetime_quota가 caller 권한으로 돌며 RLS를 통과해야 하므로 본인 행 CRUD 허용.
create policy "usage_counters_select_own"
  on usage_counters
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "usage_counters_insert_own"
  on usage_counters
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "usage_counters_update_own"
  on usage_counters
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) consume_lifetime_quota — 누적 상한 소비. caller 권한 + RLS(auth.uid()).
--    max 미만이면 1 증가시키고 allowed:true, 이미 도달했으면 증가 없이 allowed:false.
--    단일 RPC 트랜잭션 안에서 검사→증가가 원자적이다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function consume_lifetime_quota(
  p_bucket text,
  p_max integer
)
returns jsonb
language plpgsql
as $$
declare
  v_uid uuid := (select auth.uid());
  v_used integer;
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'used', 0, 'max', p_max);
  end if;

  select used into v_used
  from usage_counters
  where user_id = v_uid and bucket = p_bucket;

  v_used := coalesce(v_used, 0);

  if v_used >= p_max then
    return jsonb_build_object('allowed', false, 'used', v_used, 'max', p_max);
  end if;

  insert into usage_counters (user_id, bucket, used)
  values (v_uid, p_bucket, 1)
  on conflict (user_id, bucket)
  do update set used = usage_counters.used + 1, updated_at = now();

  return jsonb_build_object(
    'allowed', true,
    'used', v_used + 1,
    'max', p_max,
    'remaining', p_max - v_used - 1
  );
end;
$$;

alter function consume_lifetime_quota(text, integer)
  set search_path = public, pg_temp;

revoke all on function consume_lifetime_quota(text, integer) from public;
grant execute on function consume_lifetime_quota(text, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) upsert_subscription_from_polar — Polar webhook → 구독 행 upsert + 이벤트 기록.
--    SECURITY DEFINER로 RLS 우회(남의 행 write). 권한상승 방지를 위해 webhook 시크릿을
--    GUC(app.polar_webhook_secret)와 대조 — 불일치/미설정 시 예외(fail-closed).
--    도메인 UPDATE(구독 upsert) → 이벤트 INSERT 순서(부분 실패 시 미완 방지).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function upsert_subscription_from_polar(
  p_webhook_secret text,
  p_user_id uuid,
  p_polar_customer_id text,
  p_polar_subscription_id text,
  p_plan text,
  p_status text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
as $$
declare
  v_expected text := current_setting('app.polar_webhook_secret', true);
begin
  -- fail-closed: GUC 미설정(NULL/빈값)이거나 불일치면 거부.
  if v_expected is null or v_expected = '' or p_webhook_secret is null
     or p_webhook_secret <> v_expected then
    raise exception 'unauthorized billing webhook call';
  end if;

  if p_plan not in ('free', 'pro') then
    raise exception 'invalid plan: %', p_plan;
  end if;

  insert into subscriptions (
    user_id, plan, status, polar_customer_id, polar_subscription_id,
    current_period_end, cancel_at_period_end, updated_at
  )
  values (
    p_user_id, p_plan, p_status, p_polar_customer_id, p_polar_subscription_id,
    p_current_period_end, coalesce(p_cancel_at_period_end, false), now()
  )
  on conflict (user_id) do update set
    plan = excluded.plan,
    status = excluded.status,
    polar_customer_id = coalesce(excluded.polar_customer_id, subscriptions.polar_customer_id),
    polar_subscription_id = coalesce(excluded.polar_subscription_id, subscriptions.polar_subscription_id),
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    updated_at = now();

  insert into billing_events (
    user_id, polar_subscription_id, event_type, status, meta
  )
  values (
    p_user_id, p_polar_subscription_id, p_event_type, p_status,
    coalesce(p_meta, '{}'::jsonb)
  );
end;
$$;

alter function upsert_subscription_from_polar(
  text, uuid, text, text, text, text, timestamptz, boolean, text, jsonb
) set search_path = public, pg_temp;

-- webhook 라우트는 anon 클라이언트로 호출(service_role 요청경로 금지 정책 유지).
-- 시크릿 게이트가 실질 인가이므로 anon에 grant해도 권한상승 없음.
revoke all on function upsert_subscription_from_polar(
  text, uuid, text, text, text, text, timestamptz, boolean, text, jsonb
) from public;
grant execute on function upsert_subscription_from_polar(
  text, uuid, text, text, text, text, timestamptz, boolean, text, jsonb
) to anon;

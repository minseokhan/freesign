-- 0026_billing_secret_table
-- Supabase의 postgres 롤은 커스텀 GUC(app.polar_webhook_secret)를 ALTER DATABASE/ROLE로
-- 설정할 권한이 없다(42501). 0024의 GUC 게이트를 전용 설정 테이블에서 읽는 방식으로 전환한다.
-- 보안 등가: billing_config는 RLS enabled + 정책 없음 + anon/authenticated grant 회수 →
-- 직접 조회 불가. SECURITY DEFINER 함수(owner=postgres, 테이블 소유자라 RLS 우회)만 읽는다.

create table billing_config (
  id boolean primary key default true check (id),  -- 단일 행 강제(id=true만 허용)
  webhook_secret text not null default '',
  updated_at timestamptz not null default now()
);

alter table billing_config enable row level security;
-- 정책 없음 = anon/authenticated 조회 차단. 명시적으로 grant도 회수(이중 방어).
revoke all on billing_config from anon, authenticated;

-- webhook 시크릿 검증 소스를 GUC → billing_config로 교체. 그 외 로직은 0024와 동일.
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
  v_expected text;
begin
  -- DEFINER(owner=postgres)로 실행되어 billing_config를 RLS 우회 조회한다.
  select webhook_secret into v_expected from billing_config where id = true;

  -- fail-closed: 시크릿 미설정(NULL/빈값)이거나 불일치면 거부.
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

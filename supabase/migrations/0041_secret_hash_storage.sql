-- 0041_secret_hash_storage
-- OWASP 스캔 A04(low, 대시보드 #18): 크론·웹훅 공유 시크릿을 DB에 평문으로 보관하고
-- `<>`로 비교한다. DB 덤프·백업·스냅샷이 유출되면 세션 없는 특권 경계(크론 스윕·구독 upsert)를
-- 즉시 통과할 수 있는 값이 그대로 노출되고, 비교도 조기 종료라 이론적 타이밍 오라클이 남는다.
--
-- 저장을 sha256 hex로 바꾸고 게이트 함수는 입력을 같은 방식으로 해시해 비교한다.
-- (해시 비교라 조기 종료가 드러내는 건 시크릿이 아니라 해시 접두라 실익이 없다.
--  Postgres 내장 sha256(bytea)만 쓰므로 pgcrypto 확장이 필요 없다.)
--
-- 마이그레이션은 기존 평문을 그대로 해시해 옮긴 뒤 평문 컬럼을 비운다 → 시크릿 값을 다시
-- 넣을 필요가 없다(env의 CRON_SECRET·POLAR_WEBHOOK_SECRET도 그대로 둔다).
-- 이후 시크릿 교체는 아래 set_* 함수로 한다(평문 컬럼에 직접 쓰면 더 이상 효과 없음).

alter table cron_config add column if not exists secret_sha256 text not null default '';
alter table billing_config add column if not exists secret_sha256 text not null default '';

update cron_config
set secret_sha256 = encode(sha256(convert_to(cron_secret, 'UTF8')), 'hex'),
    cron_secret = ''
where cron_secret <> '';

update billing_config
set secret_sha256 = encode(sha256(convert_to(webhook_secret, 'UTF8')), 'hex'),
    webhook_secret = ''
where webhook_secret <> '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 시크릿 교체용 헬퍼(SQL Editor에서 postgres 롤로 실행). 평문을 저장하지 않는다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_cron_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_secret is null or char_length(p_secret) < 16 then
    raise exception 'cron secret must be at least 16 characters';
  end if;

  insert into cron_config (id, secret_sha256, cron_secret, updated_at)
  values (true, encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'), '', now())
  on conflict (id) do update
    set secret_sha256 = excluded.secret_sha256,
        cron_secret = '',
        updated_at = now();
end;
$$;

revoke all on function set_cron_secret(text) from public, anon, authenticated;

create or replace function set_billing_webhook_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_secret is null or char_length(p_secret) < 16 then
    raise exception 'webhook secret must be at least 16 characters';
  end if;

  insert into billing_config (id, secret_sha256, webhook_secret, updated_at)
  values (true, encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'), '', now())
  on conflict (id) do update
    set secret_sha256 = excluded.secret_sha256,
        webhook_secret = '',
        updated_at = now();
end;
$$;

revoke all on function set_billing_webhook_secret(text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 게이트 함수 — 저장된 해시와 비교(fail-closed 유지).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function assert_cron_secret(p_secret text)
returns void
language plpgsql
security definer
as $$
declare
  v_expected text;
begin
  select secret_sha256 into v_expected from cron_config where id = true;

  if v_expected is null or v_expected = '' or p_secret is null
     or encode(sha256(convert_to(p_secret, 'UTF8')), 'hex') <> v_expected then
    raise exception 'unauthorized cron call';
  end if;
end;
$$;

alter function assert_cron_secret(text) set search_path = public, pg_temp;

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
  select secret_sha256 into v_expected from billing_config where id = true;

  -- fail-closed: 시크릿 미설정(NULL/빈값)이거나 불일치면 거부.
  if v_expected is null or v_expected = '' or p_webhook_secret is null
     or encode(sha256(convert_to(p_webhook_secret, 'UTF8')), 'hex') <> v_expected then
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

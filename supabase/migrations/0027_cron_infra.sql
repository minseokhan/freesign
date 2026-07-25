-- 0027_cron_infra
-- 세션 없는 일일 크론(/api/cron/daily)이 멀티유저 데이터를 안전하게 쓰기 위한 공통 인프라.
-- 0026 billing_config와 동일 패턴: cron_config는 RLS enabled + 정책 없음 + anon/authenticated
-- grant 회수 → 직접 조회 불가. SECURITY DEFINER 함수(owner=postgres, RLS 우회)만 시크릿을 읽는다.
-- Phase 1/2의 크론 DEFINER RPC는 첫 줄에서 assert_cron_secret로 fail-closed 게이트를 통과해야 한다.

create table cron_config (
  id boolean primary key default true check (id),  -- 단일 행 강제(id=true만 허용)
  cron_secret text not null default '',
  updated_at timestamptz not null default now()
);

alter table cron_config enable row level security;
-- 정책 없음 = anon/authenticated 조회 차단. 명시적으로 grant도 회수(이중 방어).
revoke all on cron_config from anon, authenticated;

-- 크론 시크릿 게이트. 미설정(NULL/빈값)이거나 불일치면 예외 → 호출 전체 롤백(fail-closed).
-- 보안은 시크릿 게이트가 담당하므로 anon/authenticated 모두 execute 가능(billing과 동일 철학).
create or replace function assert_cron_secret(p_secret text)
returns void
language plpgsql
security definer
as $$
declare
  v_expected text;
begin
  -- DEFINER(owner=postgres)로 실행되어 cron_config를 RLS 우회 조회한다.
  select cron_secret into v_expected from cron_config where id = true;

  if v_expected is null or v_expected = '' or p_secret is null
     or p_secret <> v_expected then
    raise exception 'unauthorized cron call';
  end if;
end;
$$;

alter function assert_cron_secret(text) set search_path = public, pg_temp;

revoke all on function assert_cron_secret(text) from public;
grant execute on function assert_cron_secret(text) to anon, authenticated;

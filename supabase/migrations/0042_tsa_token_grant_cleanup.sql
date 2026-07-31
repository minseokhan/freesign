-- 0042_tsa_token_grant_cleanup
-- 0040이 3인자 store_completion_tsa_token을 새로 만들면서 `revoke all ... from public`만 했다.
-- Supabase는 public 스키마 함수에 대해 anon·authenticated·service_role에게 EXECUTE를 주는
-- ALTER DEFAULT PRIVILEGES가 걸려 있어, PUBLIC을 회수해도 authenticated의 직접 권한은 남는다
-- (원격 pg_proc.proacl에서 `authenticated=X/postgres` 확인). 0021이 2인자 버전에 대해
-- 했던 회수와 같은 정리를 3인자 버전에도 적용한다.
--
-- 실제 호출자는 세션 없는 라우트 핸들러(app/api/sign/[token])의 anon 클라이언트뿐이고,
-- 인가는 assert_cron_secret 게이트가 담당한다. 로그인 사용자에게 이 함수를 노출할 이유가 없다.

revoke execute on function store_completion_tsa_token(text, text, text) from authenticated;

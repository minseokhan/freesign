-- 0043_cron_gate_grant_cleanup
-- 0027이 assert_cron_secret에 anon·authenticated EXECUTE를 줬다. 이 함수는 시크릿이 맞으면
-- void, 틀리면 예외를 던지므로 /rest/v1/rpc/assert_cron_secret이 그대로 크론 시크릿의
-- 온라인 브루트포스 오라클이 된다(0041로 저장은 해시가 됐지만 이 표면은 남아 있었다).
--
-- 실제 호출자는 전부 SECURITY DEFINER RPC 내부다(create_dunning_drafts_for_overdue·
-- generate_due_recurring_invoices·update_dunning_draft_body·store_completion_tsa_token).
-- DEFINER 안에서는 owner(postgres) 권한으로 실행되므로 외부 EXECUTE를 회수해도 게이트는
-- 그대로 동작한다. 세션 없는 경계가 게이트 함수를 직접 부를 일은 없다.

revoke execute on function assert_cron_secret(text) from anon, authenticated;

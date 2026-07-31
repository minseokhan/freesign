-- 0044_cron_rpc_authenticated_revoke
-- 0028·0029가 크론 RPC 3개에 `to anon, authenticated`로 실행권을 줬다. 호출자는 일일 크론
-- 라우트뿐이고 거기서는 세션 없는 anon 클라이언트(lib/cron/*.ts → createAnonClient)를 쓰므로
-- authenticated 실행권은 처음부터 쓰이지 않았다. 다른 세션 없는 경계 함수(서명·증명서·웹훅)는
-- 이미 anon 전용이라 이 3개만 남은 구멍이었다.
--
-- 시크릿 게이트가 앞을 막고 있어 곧바로 악용되지는 않지만, 로그인 사용자가 크론 경계 함수를
-- 직접 부를 수 있어야 할 이유가 없다(최소 권한). anon 실행권은 유지한다 — 크론이 그 경로로 부른다.

revoke execute on function create_dunning_drafts_for_overdue(text, integer) from authenticated;
revoke execute on function generate_due_recurring_invoices(text) from authenticated;
revoke execute on function update_dunning_draft_body(text, uuid, text, text, text) from authenticated;

-- 서명 후 계약 본문 동결 (OWASP 재스캔 high #2)
--
-- 문제: contracts_update_own(0002)에 status 조건이 없어, 소유자가 PostgREST로
-- contracts를 직접 PATCH하면 발송(sent)·서명 완료(signed) 계약의 clauses·amount·
-- client_id를 바꿀 수 있었다. "초안만 편집" 가드가 Server Action과 RPC 안에만 있어
-- RPC를 안 거치면 그만이었다. 이 제품의 방어 가능한 코어가 "계약 → 서명 → 입금"
-- 증빙 체인이므로, 발송된 뒤의 본문 변경은 정책 층에서 막는다.
--
-- 안전성: 계약을 갱신하는 함수 5개(send_signature_request_with_event,
-- complete_counterparty_signature_with_event, revoke_signature_request_with_event,
-- transition_contract_status_with_event, set_contract_pdf_url)는 전부 SECURITY DEFINER이고
-- 소유자가 postgres다. contracts에 FORCE ROW LEVEL SECURITY가 없으므로 이 정책의
-- 영향을 받지 않는다. 앱의 직접 UPDATE 2곳(contracts/actions.ts)은 둘 다 이미
-- status='draft' 행만 대상으로 한다.
--
-- USING에 status를 넣었으므로 초안이 아닌 행은 애초에 UPDATE 대상에서 빠진다
-- (예외가 아니라 0행 갱신). WITH CHECK은 status를 draft 밖으로 밀어내는 것을 막는데,
-- status 컬럼은 0037에서 이미 클라이언트 UPDATE 권한이 없어 이중 방어다.

drop policy if exists "contracts_update_own" on contracts;

create policy "contracts_update_own"
  on contracts
  for update
  to authenticated
  using (user_id = (select auth.uid()) and status = 'draft')
  with check (user_id = (select auth.uid()) and status = 'draft');

-- 0021_signature_rpc_grant_hardening
-- 원격 advisor 재점검(0017~0020 적용 후) 대응.
-- Supabase는 ALTER DEFAULT PRIVILEGES로 public 스키마의 새 함수에 anon·authenticated
-- 실행권을 자동 부여한다. 0018~0020의 `revoke ... from public`은 PUBLIC 묵시 grant만
-- 제거하고 이 역할별 직접 grant는 남기므로, 역할 경계를 명시적으로 재정렬한다.
-- (로컬 테스트 하네스에는 해당 기본 권한이 없어 no-op에 가깝고, 원격에서 실효.)

-- 1) 트리거 함수는 REST RPC 표면에서 제거 (트리거로만 실행).
revoke all on function block_contract_delete_with_counterparty_signature()
  from public, anon, authenticated;

-- 2) anon 전용 DEFINER 6종에서 authenticated 제거.
revoke execute on function get_signing_session(text) from authenticated;
revoke execute on function complete_counterparty_signature_with_event(
  text, text, text, jsonb, text, text
) from authenticated;
revoke execute on function get_certificate_data(text) from authenticated;
revoke execute on function get_signed_contract_data(text) from authenticated;
revoke execute on function store_completion_tsa_token(text, text) from authenticated;
revoke execute on function consume_anon_rate_limit(text, text, integer, integer)
  from authenticated;

-- 3) authenticated 전용 3종에서 anon 제거.
revoke execute on function revoke_signature_request_with_event(uuid, text, jsonb) from anon;
revoke execute on function send_signature_request_with_event(
  uuid, text, text, text, text, text, jsonb, text, text, jsonb, text, jsonb
) from anon;
revoke execute on function transition_contract_status_with_event(
  uuid, contract_status, boolean, text, text, jsonb
) from anon;

-- 4) 성능 advisor: contract_signatures.user_id FK 커버링 인덱스 (RLS owner 스코프 조회 보조).
create index if not exists contract_signatures_user_id_idx
  on contract_signatures (user_id);

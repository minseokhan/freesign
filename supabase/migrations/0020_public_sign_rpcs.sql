-- 0020_public_sign_rpcs
-- step 8 공개 서명 표면의 anon DEFINER RPC 2종.
-- anon에는 테이블 RLS 정책이 없으므로(0018), 커밋 후 best-effort TSA 저장과
-- 완결 계약서 렌더 데이터 조회도 토큰 해시 검증을 내장한 함수로만 연다.
-- 공통 규칙은 0019와 동일: search_path 고정, revoke public, 입력 상한, 최소 필드 반환.

-- 1) store_completion_tsa_token — SECURITY DEFINER, anon 전용.
--    완결 TSA 토큰은 RPC 트랜잭션 밖(커밋 후 best-effort)에서 저장한다(0019 헤더 규칙).
--    completed 요청 + completion_tsa_token IS NULL일 때만 1회 기록(write-once) —
--    토큰 소지자가 저장된 증거를 다른 값으로 덮어쓸 수 없다.
create or replace function store_completion_tsa_token(
  p_token_hash text,
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_token_hash is null
    or char_length(p_token_hash) < 32
    or char_length(p_token_hash) > 128
  then
    return false;
  end if;

  -- TimeStampResp 원문 base64(step 4) — 형식·크기 상한 검증.
  if p_token is null
    or octet_length(p_token) > 65536
    or p_token !~ '^[A-Za-z0-9+/=]+$'
  then
    return false;
  end if;

  update signature_requests
  set completion_tsa_token = p_token
  where token_hash = p_token_hash
    and status = 'completed'
    and completion_tsa_token is null;

  get diagnostics v_updated = row_count;

  return v_updated = 1;
end;
$$;

revoke all on function store_completion_tsa_token(text, text) from public;
grant execute on function store_completion_tsa_token(text, text) to anon;

-- 2) get_signed_contract_data — SECURITY DEFINER, anon 전용.
--    completed 요청의 토큰 소지자에게 서명 완료 계약서 PDF 렌더에 필요한
--    필드만 반환한다(상대방 교부용 다운로드 + 완료 이메일 첨부).
--    owner 서명 이미지는 Storage key라 anon에 반환하지 않는다(서명 메타만).
create or replace function get_signed_contract_data(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request signature_requests%rowtype;
  v_contract contracts%rowtype;
  v_client_name text;
  v_counterparty jsonb;
begin
  if p_token_hash is null
    or char_length(p_token_hash) < 32
    or char_length(p_token_hash) > 128
  then
    return null;
  end if;

  select *
  into v_request
  from signature_requests
  where token_hash = p_token_hash
    and status = 'completed';

  if not found then
    return null;
  end if;

  select *
  into v_contract
  from contracts
  where id = v_request.contract_id
    and deleted_at is null;

  if not found then
    return null;
  end if;

  select name
  into v_client_name
  from clients
  where id = v_contract.client_id;

  select jsonb_build_object(
    'signer_name', s.signer_name,
    'signer_email', s.signer_email,
    'signed_at', s.signed_at,
    'signature_image_data', s.signature_image_data
  )
  into v_counterparty
  from contract_signatures s
  where s.contract_id = v_request.contract_id
    and s.request_id = v_request.id
    and s.party = 'counterparty'
  limit 1;

  return jsonb_build_object(
    'owner_user_id', v_request.user_id,
    'client_name', v_client_name,
    'contract', jsonb_build_object(
      'id', v_contract.id,
      'title', v_contract.title,
      'scope', v_contract.scope,
      'amount', v_contract.amount,
      'start_date', v_contract.start_date,
      'end_date', v_contract.end_date,
      'status', v_contract.status,
      'clauses', v_contract.clauses,
      'plain_summary', v_contract.plain_summary,
      'doc_hash', v_contract.doc_hash,
      'signature_meta', v_contract.signature_meta
    ),
    'counterparty_signature', v_counterparty
  );
end;
$$;

revoke all on function get_signed_contract_data(text) from public;
grant execute on function get_signed_contract_data(text) to anon;

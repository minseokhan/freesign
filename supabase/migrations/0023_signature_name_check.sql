-- 0023_signature_name_check
-- 수동 E2E 피드백 대응(전자서명 v2):
--   * complete_counterparty_signature_with_event — 서명자가 입력한 이름이
--     요청서에 지정된 수신자 이름(recipient_name)과 일치하는지 검증. 불일치 시 거부.
--     (공백 제거·소문자 정규화 후 비교. recipient_name이 비어 있으면 검증 생략.)
--   * get_signed_contract_data — 서식 PDF 상대방 블록을 owner 블록과 대칭으로
--     표기하기 위해 counterparty 서명의 ip/ua(meta)를 평탄화해 반환.
-- 공통 규칙은 0019~0022와 동일: search_path 고정, create or replace로 ACL 유지.

-- 1) 이름 일치 검증 추가 — 0019 함수를 전체 재정의(create or replace, ACL 유지).
create or replace function complete_counterparty_signature_with_event(
  p_token_hash text,
  p_signature_image_data text,
  p_signer_name text,
  p_consent jsonb,
  p_ip text,
  p_ua text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request signature_requests%rowtype;
  v_contract contracts%rowtype;
  v_owner_email text;
  v_consent jsonb;
begin
  if p_token_hash is null
    or char_length(p_token_hash) < 32
    or char_length(p_token_hash) > 128
  then
    raise exception 'signature request not found';
  end if;

  if p_signature_image_data is null
    or octet_length(p_signature_image_data) > 262144
    or p_signature_image_data !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$'
  then
    raise exception 'invalid signature image';
  end if;

  if p_signer_name is not null and char_length(p_signer_name) > 120 then
    raise exception 'invalid signer name';
  end if;

  v_consent := coalesce(p_consent, '{}'::jsonb);

  if jsonb_typeof(v_consent) <> 'object' or pg_column_size(v_consent) > 8192 then
    raise exception 'invalid consent';
  end if;

  select *
  into v_request
  from signature_requests
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'signature request not found';
  end if;

  if v_request.status = 'completed' then
    raise exception 'signature request already completed';
  end if;

  if v_request.status = 'revoked' then
    raise exception 'signature request revoked';
  end if;

  if v_request.expires_at <= now() then
    raise exception 'signature request expired';
  end if;

  -- 서명자 이름이 요청 시 지정한 수신자 이름과 일치하는지 검증한다.
  -- (공백 전부 제거 + 소문자 정규화 후 비교. recipient_name이 비어 있으면 검증 생략.)
  if v_request.recipient_name is not null
    and length(btrim(v_request.recipient_name)) > 0
    and lower(regexp_replace(coalesce(p_signer_name, ''), '\s', '', 'g'))
      is distinct from lower(regexp_replace(v_request.recipient_name, '\s', '', 'g'))
  then
    raise exception 'signer name mismatch';
  end if;

  select *
  into v_contract
  from contracts
  where id = v_request.contract_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'contract not found';
  end if;

  if v_contract.status <> 'sent' then
    raise exception 'contract is not awaiting a counterparty signature';
  end if;

  if v_contract.doc_hash is distinct from v_request.frozen_doc_hash then
    raise exception 'document hash mismatch';
  end if;

  insert into contract_signatures (
    user_id,
    contract_id,
    request_id,
    party,
    signer_email,
    signer_name,
    signature_image_data,
    doc_hash,
    consent,
    meta
  )
  values (
    v_request.user_id,
    v_request.contract_id,
    v_request.id,
    'counterparty',
    v_request.recipient_email,
    p_signer_name,
    p_signature_image_data,
    v_request.frozen_doc_hash,
    v_consent,
    jsonb_build_object(
      'ip', left(coalesce(p_ip, 'unknown'), 255),
      'ua', left(coalesce(p_ua, 'unknown'), 512)
    )
  );

  update signature_requests
  set status = 'completed',
      completed_at = now()
  where id = v_request.id;

  update contracts
  set status = 'signed'
  where id = v_request.contract_id;

  insert into contract_events (
    user_id,
    contract_id,
    actor,
    from_status,
    to_status,
    event_type,
    meta
  )
  values (
    v_request.user_id,
    v_request.contract_id,
    'counterparty:' || v_request.recipient_email,
    'sent',
    'signed',
    'contract.counterparty_signed',
    jsonb_build_object(
      'ip', left(coalesce(p_ip, 'unknown'), 255),
      'ua', left(coalesce(p_ua, 'unknown'), 512),
      'consent', v_consent
    )
  );

  select email
  into v_owner_email
  from auth.users
  where id = v_request.user_id;

  -- 완료 알림 발송에 필요한 최소 필드만 반환한다.
  return jsonb_build_object(
    'request_id', v_request.id,
    'contract_id', v_request.contract_id,
    'contract_title', v_contract.title,
    'owner_email', v_owner_email,
    'recipient_email', v_request.recipient_email,
    'recipient_name', v_request.recipient_name
  );
end;
$$;

-- 2) get_signed_contract_data 재정의 — counterparty 서명에 ip/ua 추가(서식 PDF 대칭).
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
  v_owner jsonb;
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
  into v_owner
  from contract_signatures s
  where s.contract_id = v_request.contract_id
    and s.request_id = v_request.id
    and s.party = 'owner'
  limit 1;

  select jsonb_build_object(
    'signer_name', s.signer_name,
    'signer_email', s.signer_email,
    'signed_at', s.signed_at,
    'signature_image_data', s.signature_image_data,
    'ip', s.meta ->> 'ip',
    'ua', s.meta ->> 'ua'
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
    'owner_signature', v_owner,
    'counterparty_signature', v_counterparty
  );
end;
$$;

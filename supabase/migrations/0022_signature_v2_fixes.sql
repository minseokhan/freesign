-- 0022_signature_v2_fixes
-- 수동 E2E 피드백 대응 (docs/SIGNATURE_V2_FIXES_PLAN.md):
--   * owner 서명 행 meta에 ip/ua 저장 — anon 완결증명서에서 "기록 없음" 방지.
--   * owner 서명 이미지를 base64로도 저장(ADR-009 예외 확장) —
--     상대방 교부용 PDF에 양쪽 서명을 모두 표기하기 위함.
--   * get_certificate_data가 contracts.signature_meta를 반환 —
--     기존 완결 계약(owner meta '{}')도 폴백으로 ip/ua 표기.
--   * get_signed_contract_data가 owner_signature(이미지 포함)를 반환.
-- 공통 규칙은 0019~0021과 동일: search_path 고정, revoke public, 역할별 grant 재정렬.

-- 1) 서명 이미지 제약 완화: XOR(둘 중 하나만) → 적어도 하나.
--    owner 행은 Storage key(경로)와 base64 사본을 함께 가진다.
alter table contract_signatures
  drop constraint contract_signatures_image_xor;

alter table contract_signatures
  add constraint contract_signatures_image_present check (
    (signature_image_path is not null) or (signature_image_data is not null)
  );

-- 2) send_signature_request_with_event 재정의 — p_signature_image_data 추가.
--    시그니처가 바뀌므로 구(12인자) 함수를 drop한다. 새 인자는 default null이라
--    구 코드의 12인자 named-args 호출(PostgREST)은 그대로 동작한다(오버로드 모호성 방지).
drop function if exists send_signature_request_with_event(
  uuid, text, text, text, text, text, jsonb, text, text, jsonb, text, jsonb
);

create function send_signature_request_with_event(
  p_contract_id uuid,
  p_token_hash text,
  p_recipient_email text,
  p_recipient_name text,
  p_signature_image_path text,
  p_doc_hash text,
  p_signature_meta jsonb,
  p_signer_email text,
  p_signer_name text,
  p_consent jsonb,
  p_actor text,
  p_meta jsonb default '{}'::jsonb,
  -- 맨 끝 + default: 구(12인자) named/positional 호출이 그대로 동작한다.
  p_signature_image_data text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
  v_request_id uuid;
begin
  -- counterparty 검증(0019 complete RPC)과 동급의 owner 서명 이미지 검증.
  if p_signature_image_data is not null
    and (
      octet_length(p_signature_image_data) > 262144
      or p_signature_image_data !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$'
    )
  then
    raise exception 'invalid signature image';
  end if;

  select *
  into v_contract
  from contracts
  where id = p_contract_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'contract not found';
  end if;

  if v_contract.status <> 'draft' then
    raise exception 'only draft contracts can send a signature request';
  end if;

  update contracts
  set status = 'sent',
      signature_image_path = p_signature_image_path,
      doc_hash = p_doc_hash,
      signature_meta = p_signature_meta
  where id = p_contract_id;

  insert into signature_requests (
    user_id,
    contract_id,
    token_hash,
    recipient_email,
    recipient_name,
    status,
    frozen_doc_hash,
    expires_at
  )
  values (
    v_contract.user_id,
    p_contract_id,
    p_token_hash,
    p_recipient_email,
    p_recipient_name,
    'pending',
    p_doc_hash,
    now() + interval '14 days'
  )
  returning id into v_request_id;

  insert into contract_signatures (
    user_id,
    contract_id,
    request_id,
    party,
    signer_email,
    signer_name,
    signature_image_path,
    signature_image_data,
    doc_hash,
    consent,
    meta
  )
  values (
    v_contract.user_id,
    p_contract_id,
    v_request_id,
    'owner',
    p_signer_email,
    p_signer_name,
    p_signature_image_path,
    p_signature_image_data,
    p_doc_hash,
    coalesce(p_consent, '{}'::jsonb),
    -- 완결증명서용 ip/ua — counterparty 행 meta와 동일한 형태.
    jsonb_strip_nulls(
      jsonb_build_object(
        'ip', p_signature_meta ->> 'ip',
        'ua', p_signature_meta ->> 'ua'
      )
    )
  );

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
    v_contract.user_id,
    p_contract_id,
    p_actor,
    v_contract.status::text,
    'sent',
    'signature_request.sent',
    coalesce(p_meta, '{}'::jsonb)
      || jsonb_build_object('request_id', v_request_id, 'recipient_email', p_recipient_email)
  );

  return v_request_id;
end;
$$;

-- 신규 시그니처에는 원격 default privileges가 anon·authenticated 실행권을 다시 붙인다
-- (0021 배경) — 역할 경계를 명시적으로 재정렬한다.
revoke all on function send_signature_request_with_event(
  uuid, text, text, text, text, text, jsonb, text, text, jsonb, text, jsonb, text
) from public, anon;

grant execute on function send_signature_request_with_event(
  uuid, text, text, text, text, text, jsonb, text, text, jsonb, text, jsonb, text
) to authenticated;

-- 3) get_certificate_data 재정의 — contract에 signature_meta 포함.
--    owner 행 meta가 비어 있는 기존 완결 계약도 contracts.signature_meta 폴백으로
--    보낸 쪽 ip/ua를 표기할 수 있다. (create or replace — 기존 ACL 유지.)
create or replace function get_certificate_data(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request signature_requests%rowtype;
  v_contract contracts%rowtype;
  v_signatures jsonb;
  v_events jsonb;
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
  where id = v_request.contract_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'party', s.party,
        'signer_name', s.signer_name,
        'signer_email', s.signer_email,
        'signed_at', s.signed_at,
        'consent', s.consent,
        'meta', s.meta
      )
      order by s.signed_at, s.party
    ),
    '[]'::jsonb
  )
  into v_signatures
  from contract_signatures s
  where s.contract_id = v_request.contract_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'actor', e.actor,
        'from_status', e.from_status,
        'to_status', e.to_status,
        'event_type', e.event_type,
        'created_at', e.created_at
      )
      order by e.created_at, e.id
    ),
    '[]'::jsonb
  )
  into v_events
  from contract_events e
  where e.contract_id = v_request.contract_id;

  return jsonb_build_object(
    'contract', jsonb_build_object(
      'id', v_contract.id,
      'title', v_contract.title,
      'clauses', v_contract.clauses,
      'doc_hash', v_contract.doc_hash,
      'signature_meta', v_contract.signature_meta
    ),
    'signatures', v_signatures,
    'events', v_events,
    'tsa', jsonb_build_object(
      'sent_tsa_token', v_request.sent_tsa_token,
      'completion_tsa_token', v_request.completion_tsa_token
    ),
    'completed_at', v_request.completed_at
  );
end;
$$;

-- 4) get_signed_contract_data 재정의 — owner_signature 반환 추가.
--    owner 서명 이미지가 base64로 저장된 계약(이 마이그레이션 이후 발송)만 이미지가 담기고,
--    구 계약은 signature_image_data null(렌더러가 메타만 표기). (create or replace — ACL 유지.)
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
    'owner_signature', v_owner,
    'counterparty_signature', v_counterparty
  );
end;
$$;

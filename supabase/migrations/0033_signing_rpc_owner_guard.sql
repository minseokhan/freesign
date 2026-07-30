-- 0033_signing_rpc_owner_guard
-- OWASP 스캔(A01) 확정 항목: 토큰 기반 anon SECURITY DEFINER RPC 4종이
-- "토큰 해시가 가리키는 signature_requests 행의 contract_id"를 무조건 신뢰한다.
-- 이 함수들은 RLS를 전면 우회하므로, 요청 행의 소유자(signature_requests.user_id)와
-- 계약의 소유자(contracts.user_id)가 일치하는지 확인하지 않으면 요청 행이 한 번이라도
-- 위조·재지정되는 순간 인증 없는 anon 라우트가 타 테넌트의 계약 본문·서명 증거를 반환한다.
--
-- 0032가 정책 레벨에서 위조를 막지만, RLS 밖에서 도는 경계는 자체적으로 fail-closed여야 한다
-- (CLAUDE.md: 세션 없는 경계의 멀티유저 접근은 게이트 내장 DEFINER RPC로만, 내부에서 검증).
--
-- 변경은 각 계약 조회에 `and user_id = v_request.user_id` 가드 + not found 처리 추가뿐이다.
-- 시그니처·반환 필드·나머지 로직은 직전 정의(0019·0022·0023)와 100% 동일하며,
-- create or replace이므로 기존 ACL(anon 전용 실행권)이 유지된다.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) get_signing_session — 직전 정의: 0019_signature_rpcs.sql
--    계약 조회에 소유자 일치 가드 + not found 시 null(원본에는 not found 처리가 없어
--    소유자 불일치 시 v_contract가 비어 있는 채로 응답이 나갔다).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function get_signing_session(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request signature_requests%rowtype;
  v_contract contracts%rowtype;
  v_sender_name text;
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
  for update;

  if not found then
    return null;
  end if;

  if v_request.status = 'revoked' then
    return jsonb_build_object('state', 'revoked');
  end if;

  -- 소유자 일치 가드: 요청 행을 만든 사용자가 그 계약의 소유자여야 한다.
  select *
  into v_contract
  from contracts
  where id = v_request.contract_id
    and user_id = v_request.user_id;

  if not found then
    return null;
  end if;

  if v_request.status = 'completed' then
    return jsonb_build_object(
      'state', 'completed',
      'contract_title', v_contract.title
    );
  end if;

  if v_request.expires_at <= now() then
    return jsonb_build_object('state', 'expired');
  end if;

  if v_request.first_viewed_at is null then
    update signature_requests
    set first_viewed_at = now()
    where id = v_request.id;

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
      'sent',
      'signature_request.viewed',
      jsonb_build_object('request_id', v_request.id)
    );
  end if;

  select coalesce(p.display_name, u.email)
  into v_sender_name
  from auth.users u
  left join profiles p on p.user_id = u.id
  where u.id = v_request.user_id;

  return jsonb_build_object(
    'state', 'pending',
    'contract_title', v_contract.title,
    'clauses', v_contract.clauses,
    'frozen_doc_hash', v_request.frozen_doc_hash,
    'recipient_name', v_request.recipient_name,
    'sender_name', v_sender_name,
    'expires_at', v_request.expires_at
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) complete_counterparty_signature_with_event — 직전 정의: 0023_signature_name_check.sql
--    계약 조회에 소유자 일치 가드 추가(불일치는 기존 'contract not found' 예외로 fail-closed).
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- 소유자 일치 가드: 요청 행의 소유자와 계약 소유자가 다르면 위조 요청이므로 거부한다.
  select *
  into v_contract
  from contracts
  where id = v_request.contract_id
    and user_id = v_request.user_id
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) get_certificate_data — 직전 정의: 0022_signature_v2_fixes.sql
--    계약 조회에 소유자 일치 가드 + not found 시 null.
--    집계 대상(contract_signatures·contract_events)도 요청 소유자로 스코프해
--    타인이 주입한 행이 완결증명서 타임라인에 섞이지 않게 한다.
-- ─────────────────────────────────────────────────────────────────────────────
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
  where id = v_request.contract_id
    and user_id = v_request.user_id;

  if not found then
    return null;
  end if;

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
  where s.contract_id = v_request.contract_id
    and s.user_id = v_request.user_id;

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
  where e.contract_id = v_request.contract_id
    and e.user_id = v_request.user_id;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) get_signed_contract_data — 직전 정의: 0023_signature_name_check.sql
--    계약 조회에 소유자 일치 가드 추가(기존 not found → null 처리 그대로).
--    서명 행 조회도 요청 소유자로 스코프한다.
-- ─────────────────────────────────────────────────────────────────────────────
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
    and user_id = v_request.user_id
    and deleted_at is null;

  if not found then
    return null;
  end if;

  select name
  into v_client_name
  from clients
  where id = v_contract.client_id
    and user_id = v_request.user_id;

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
    and s.user_id = v_request.user_id
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
    and s.user_id = v_request.user_id
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

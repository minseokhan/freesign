-- 0019_signature_rpcs
-- 쌍방 서명 트랜잭션 경계: 발송·열람·완결·철회 RPC와 anon 접근 표면.
-- 공통 규칙:
--   * 모든 함수는 search_path = public, pg_temp 고정 (0015 하드닝 관례).
--   * 생성 직후 revoke all ... from public, 필요한 롤에만 grant.
--   * anon-grant 함수(get_signing_session·complete_...·get_certificate_data)는
--     입력 길이 상한을 검증하고 반환 필드를 최소화한다 (SIGNATURE_V2_PLAN §4-1).
--   * 도메인 UPDATE/INSERT 뒤에 이벤트 INSERT (CLAUDE.md 순서 규칙).
--   * TSA 토큰 저장은 RPC 트랜잭션 밖(커밋 후 best-effort) — 여기서 다루지 않는다.

-- 1) send_signature_request_with_event — SECURITY INVOKER, authenticated 전용.
--    호출자 RLS로 소유권이 스코프되고, draft 검증 후
--    owner 서명 기록(기존 sign route와 동일 컬럼) + 요청 생성 + draft→sent 전이를 원자화한다.
create or replace function send_signature_request_with_event(
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
  p_meta jsonb default '{}'::jsonb
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
    p_doc_hash,
    coalesce(p_consent, '{}'::jsonb),
    '{}'::jsonb
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

revoke all on function send_signature_request_with_event(
  uuid, text, text, text, text, text, jsonb, text, text, jsonb, text, jsonb
) from public;
grant execute on function send_signature_request_with_event(
  uuid, text, text, text, text, text, jsonb, text, text, jsonb, text, jsonb
) to authenticated;

-- 2) get_signing_session — SECURITY DEFINER, anon 전용.
--    토큰 해시 소지자에게 상태별 최소 필드만 jsonb로 반환한다.
--    pending 유효 시 first_viewed_at이 null일 때만 1회 기록 + viewed 이벤트.
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

  select *
  into v_contract
  from contracts
  where id = v_request.contract_id;

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

revoke all on function get_signing_session(text) from public;
grant execute on function get_signing_session(text) to anon;

-- 3) complete_counterparty_signature_with_event — SECURITY DEFINER, anon 전용.
--    단일 트랜잭션에서 잠금 → 검증(pending·미만료·sent·frozen_doc_hash 일치) →
--    counterparty 서명 INSERT → 요청 completed → sent→signed → 이벤트 INSERT.
--    검증·INSERT·전이가 한 트랜잭션이어야 TOCTOU가 제거된다.
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

revoke all on function complete_counterparty_signature_with_event(
  text, text, text, jsonb, text, text
) from public;
grant execute on function complete_counterparty_signature_with_event(
  text, text, text, jsonb, text, text
) to anon;

-- 4) revoke_signature_request_with_event — SECURITY DEFINER, authenticated 전용.
--    계획서는 INVOKER를 명시했지만 contract_signatures에는 의도적으로 DELETE 정책이
--    없어(불변 증거, 0018) INVOKER로는 owner 서명 행 삭제가 조용히 0건이 된다.
--    DELETE 정책 추가는 불변성 경계를 넓히므로, 대신 auth.uid() 소유권 검증을 내장한
--    DEFINER로 국한한다. anon에는 grant하지 않아 anon 표면은 늘지 않는다.
create or replace function revoke_signature_request_with_event(
  p_request_id uuid,
  p_actor text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_request signature_requests%rowtype;
  v_contract contracts%rowtype;
begin
  v_uid := (select auth.uid());

  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select *
  into v_request
  from signature_requests
  where id = p_request_id
    and user_id = v_uid
  for update;

  if not found then
    raise exception 'signature request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'only pending signature requests can be revoked';
  end if;

  select *
  into v_contract
  from contracts
  where id = v_request.contract_id
  for update;

  if not found then
    raise exception 'contract not found';
  end if;

  update signature_requests
  set status = 'revoked'
  where id = v_request.id;

  -- signed→draft 리셋(0012 transition)과 동일한 owner 서명 아티팩트 초기화.
  update contracts
  set status = 'draft',
      signature_meta = null,
      doc_hash = null,
      signature_image_path = null
  where id = v_request.contract_id;

  -- pending 철회 시점에는 counterparty 행이 존재할 수 없는 상태다(완결 시 completed 전이).
  delete from contract_signatures
  where contract_id = v_request.contract_id
    and party = 'owner';

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
    p_actor,
    v_contract.status::text,
    'draft',
    'signature_request.revoked',
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('request_id', v_request.id)
  );

  return v_request.id;
end;
$$;

revoke all on function revoke_signature_request_with_event(uuid, text, jsonb) from public;
grant execute on function revoke_signature_request_with_event(uuid, text, jsonb) to authenticated;

-- 5) get_certificate_data — SECURITY DEFINER, anon 전용.
--    completed 요청의 토큰 소지자에게 완결증명서 데이터만 반환한다(step 7·8에서 사용).
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
      'doc_hash', v_contract.doc_hash
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

revoke all on function get_certificate_data(text) from public;
grant execute on function get_certificate_data(text) to anon;

-- 6) transition_contract_status_with_event 재정의 (0012 원본 유지, 여기서 교체).
--    counterparty 서명이 존재하는 계약은 draft로 되돌릴 수 없다 (DB 이중 가드).
create or replace function transition_contract_status_with_event(
  p_contract_id uuid,
  p_to_status contract_status,
  p_reset_signature_artifacts boolean,
  p_actor text,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
begin
  select *
  into v_contract
  from contracts
  where id = p_contract_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'contract not found';
  end if;

  if p_to_status = 'draft' and exists (
    select 1
    from contract_signatures
    where contract_id = p_contract_id
      and party = 'counterparty'
  ) then
    raise exception 'cannot revert a contract with a counterparty signature to draft';
  end if;

  update contracts
  set status = p_to_status,
      signature_meta = case when p_reset_signature_artifacts then null else signature_meta end,
      doc_hash = case when p_reset_signature_artifacts then null else doc_hash end,
      signature_image_path = case
        when p_reset_signature_artifacts then null
        else signature_image_path
      end
  where id = p_contract_id;

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
    p_to_status::text,
    p_event_type,
    coalesce(p_meta, '{}'::jsonb)
  );

  return p_contract_id;
end;
$$;

revoke all on function transition_contract_status_with_event(
  uuid, contract_status, boolean, text, text, jsonb
) from public;
grant execute on function transition_contract_status_with_event(
  uuid, contract_status, boolean, text, text, jsonb
) to authenticated;

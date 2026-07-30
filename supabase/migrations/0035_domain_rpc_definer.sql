-- 0035_domain_rpc_definer
-- OWASP 스캔 A08·A09(high, 대시보드 #30·#31·#36·#6)의 선행 작업.
--
-- 문제의 구조: 상태 전이 RPC들이 SECURITY INVOKER라 도메인 UPDATE/INSERT가 호출자 권한으로
-- 수행된다. 그래서 서버 소유 필드(contracts.status·doc_hash·signature_meta,
-- invoices.payment_status·paid_at)와 증거 테이블(contract_signatures·contract_events)에
-- authenticated 쓰기 권한을 남겨둘 수밖에 없었고, 같은 권한이 PostgREST 직접 호출에도 열려 있다.
-- 즉 클라이언트가 Server Action과 이벤트 로그를 통째로 우회해 상태를 바꿀 수 있다.
--
-- 이 마이그레이션은 그 전제를 없앤다: 상태 전이 RPC를 SECURITY DEFINER로 바꾸고, RLS가 해주던
-- 소유권 판정을 함수 내부에서 auth.uid()로 직접 한다. 권한 회수(revoke)는 다음 마이그레이션에서
-- 한다 — 함수가 먼저 DEFINER여야 정상 경로가 살아남기 때문이다.
--
-- DEFINER 전환의 위험: RLS가 더 이상 걸리지 않으므로 부모 조회에 소유자 조건이 빠지면
-- 그 자체가 크로스 테넌트 취약점이 된다. 그래서 모든 부모 조회에 user_id = auth.uid()를 넣고,
-- 세션이 없으면(auth.uid() is null) 조회가 실패해 fail-closed가 되도록 했다.
-- 또 0012 시절 함수들에 남아 있던 anon EXECUTE 권한을 회수한다(DEFINER에서는 치명적).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) sign_contract_with_event 제거
--    v2에서 단독 서명 워크플로우가 폐기됐고(쌍방 서명으로 일원화) 유일한 호출자였던
--    /api/contracts/[id]/sign 라우트도 이 커밋에서 삭제한다. 살려두면 DEFINER 전환 대상만
--    늘고, 쌍방 서명 절차와 플랜 게이트를 건너뛰는 경로가 남는다(대시보드 #23).
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists sign_contract_with_event(uuid, text, text, jsonb, text, text, jsonb);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) transition_contract_status_with_event
-- ─────────────────────────────────────────────────────────────────────────────
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
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
begin
  -- RLS를 대신하는 소유권 판정. auth.uid()가 null이면 not found로 떨어진다(fail-closed).
  select *
  into v_contract
  from contracts
  where id = p_contract_id
    and user_id = (select auth.uid())
    and deleted_at is null
  for update;

  if not found then
    raise exception 'contract not found';
  end if;

  -- 0019에서 추가된 가드: 상대방 서명이 있는 계약은 draft로 되돌릴 수 없다(증거 체인 보호).
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
    user_id, contract_id, actor, from_status, to_status, event_type, meta
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
) from public, anon;
grant execute on function transition_contract_status_with_event(
  uuid, contract_status, boolean, text, text, jsonb
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) import_signed_contract_with_event
--    소유자를 클라이언트 행에서 가져오므로(v_client.user_id) 그 조회가 소유권 경계다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function import_signed_contract_with_event(
  p_contract_id uuid,
  p_client_id uuid,
  p_title text,
  p_scope text,
  p_amount bigint,
  p_start_date date,
  p_end_date date,
  p_clauses jsonb,
  p_plain_summary text,
  p_doc_hash text,
  p_source_pdf_url text,
  p_actor text,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client clients%rowtype;
begin
  select *
  into v_client
  from clients
  where id = p_client_id
    and user_id = (select auth.uid())
    and deleted_at is null;

  if not found then
    raise exception 'client not found';
  end if;

  insert into contracts (
    id, user_id, client_id, title, scope, amount, start_date, end_date,
    status, clauses, plain_summary, doc_hash, source_pdf_url
  )
  values (
    p_contract_id, v_client.user_id, p_client_id, p_title, p_scope, p_amount,
    p_start_date, p_end_date, 'signed', p_clauses, p_plain_summary, p_doc_hash,
    p_source_pdf_url
  );

  insert into contract_events (
    user_id, contract_id, actor, from_status, to_status, event_type, meta
  )
  values (
    v_client.user_id, p_contract_id, p_actor, null, 'signed', p_event_type,
    coalesce(p_meta, '{}'::jsonb)
  );

  return p_contract_id;
end;
$$;

revoke all on function import_signed_contract_with_event(
  uuid, uuid, text, text, bigint, date, date, jsonb, text, text, text, text, text, jsonb
) from public, anon;
grant execute on function import_signed_contract_with_event(
  uuid, uuid, text, text, bigint, date, date, jsonb, text, text, text, text, text, jsonb
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) issue_invoice_with_event
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function issue_invoice_with_event(
  p_contract_id uuid,
  p_client_id uuid,
  p_amount bigint,
  p_issue_date date,
  p_due_date date,
  p_withholding_type withholding_type,
  p_withholding_amount bigint,
  p_net_amount bigint,
  p_actor text,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
  v_invoice_id uuid;
begin
  select *
  into v_contract
  from contracts
  where id = p_contract_id
    and user_id = (select auth.uid())
    and deleted_at is null;

  if not found then
    raise exception 'contract not found';
  end if;

  -- 계약의 클라이언트와 일치해야 하므로 client_id도 자동으로 같은 소유자로 묶인다.
  if v_contract.client_id <> p_client_id then
    raise exception 'invoice client does not match contract client';
  end if;

  insert into invoices (
    user_id, contract_id, client_id, amount, issue_date, due_date,
    withholding_type, withholding_amount, net_amount, payment_status
  )
  values (
    v_contract.user_id, p_contract_id, p_client_id, p_amount, p_issue_date, p_due_date,
    p_withholding_type, p_withholding_amount, p_net_amount, 'unpaid'
  )
  returning id into v_invoice_id;

  insert into invoice_events (
    user_id, invoice_id, actor, from_status, to_status, event_type, meta
  )
  values (
    v_contract.user_id, v_invoice_id, p_actor, null, 'unpaid', p_event_type,
    coalesce(p_meta, '{}'::jsonb)
  );

  return v_invoice_id;
end;
$$;

revoke all on function issue_invoice_with_event(
  uuid, uuid, bigint, date, date, withholding_type, bigint, bigint, text, text, jsonb
) from public, anon;
grant execute on function issue_invoice_with_event(
  uuid, uuid, bigint, date, date, withholding_type, bigint, bigint, text, text, jsonb
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) set_invoice_payment_with_event
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_invoice_payment_with_event(
  p_invoice_id uuid,
  p_to_status payment_status,
  p_paid_at timestamptz,
  p_payment_method text,
  p_actor text,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice invoices%rowtype;
begin
  select *
  into v_invoice
  from invoices
  where id = p_invoice_id
    and user_id = (select auth.uid())
    and deleted_at is null
  for update;

  if not found then
    raise exception 'invoice not found';
  end if;

  update invoices
  set payment_status = p_to_status,
      paid_at = p_paid_at,
      payment_method = p_payment_method
  where id = p_invoice_id;

  insert into invoice_events (
    user_id, invoice_id, actor, from_status, to_status, event_type, meta
  )
  values (
    v_invoice.user_id, p_invoice_id, p_actor, v_invoice.payment_status::text,
    p_to_status::text, p_event_type, coalesce(p_meta, '{}'::jsonb)
  );

  return p_invoice_id;
end;
$$;

revoke all on function set_invoice_payment_with_event(
  uuid, payment_status, timestamptz, text, text, text, jsonb
) from public, anon;
grant execute on function set_invoice_payment_with_event(
  uuid, payment_status, timestamptz, text, text, text, jsonb
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) send_signature_request_with_event
--    이 함수가 INVOKER인 것이 signature_requests·contract_signatures·contract_events의
--    클라이언트 INSERT 권한을 열어두게 만든 직접 원인이다(0032 주석 참조).
-- ─────────────────────────────────────────────────────────────────────────────
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
  p_meta jsonb default '{}'::jsonb,
  p_signature_image_data text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
  v_request_id uuid;
begin
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
    and user_id = (select auth.uid())
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
    user_id, contract_id, token_hash, recipient_email, recipient_name,
    status, frozen_doc_hash, expires_at
  )
  values (
    v_contract.user_id, p_contract_id, p_token_hash, p_recipient_email, p_recipient_name,
    'pending', p_doc_hash, now() + interval '14 days'
  )
  returning id into v_request_id;

  insert into contract_signatures (
    user_id, contract_id, request_id, party, signer_email, signer_name,
    signature_image_path, signature_image_data, doc_hash, consent, meta
  )
  values (
    v_contract.user_id, p_contract_id, v_request_id, 'owner', p_signer_email, p_signer_name,
    p_signature_image_path, p_signature_image_data, p_doc_hash,
    coalesce(p_consent, '{}'::jsonb),
    jsonb_strip_nulls(
      jsonb_build_object('ip', p_signature_meta ->> 'ip', 'ua', p_signature_meta ->> 'ua')
    )
  );

  insert into contract_events (
    user_id, contract_id, actor, from_status, to_status, event_type, meta
  )
  values (
    v_contract.user_id, p_contract_id, p_actor, v_contract.status::text, 'sent',
    'signature_request.sent',
    coalesce(p_meta, '{}'::jsonb)
      || jsonb_build_object('request_id', v_request_id, 'recipient_email', p_recipient_email)
  );

  return v_request_id;
end;
$$;

revoke all on function send_signature_request_with_event(
  uuid, text, text, text, text, text, jsonb, text, text, jsonb, text, jsonb, text
) from public, anon;
grant execute on function send_signature_request_with_event(
  uuid, text, text, text, text, text, jsonb, text, text, jsonb, text, jsonb, text
) to authenticated;

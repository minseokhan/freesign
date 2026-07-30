-- 0036_evidence_table_write_lockdown
-- OWASP 스캔 A08·A09(high, 대시보드 #30·#36): 증거·감사 테이블이 PostgREST 직접 INSERT에
-- 열려 있다. 0032가 부모 계약 소유권을 요구하도록 정책을 좁혀 크로스 테넌트 주입은 막았지만,
-- 소유자가 자기 계약에 임의의 서명 행·감사 이벤트를 만들어 넣는 경로는 그대로 남아 있었다.
-- (예: 상대방 서명 시각을 앞당긴 행, 존재하지 않은 열람 이벤트 → 완결증명서 타임라인 위조)
--
-- 0035에서 상태 전이 RPC가 전부 DEFINER가 됐으므로 이제 테이블 권한 자체를 회수할 수 있다.
-- 정상 경로에 남아 있던 직접 INSERT 2곳(데모 시드·독촉 발송 이력)은 아래 append_* RPC로 옮긴다.
--
-- 남는 표면(의도적): signature_requests UPDATE. 발송 TSA 토큰 저장과 재발송 토큰 교체가
-- 세션 있는 Server Action에서 일어나고, 재발송은 원문 토큰을 메일로 보내야 해서 해시를
-- 클라이언트가 만든다. 0032 정책(내 계약 + pending + status 고정)이 이 경로를 스코프한다.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 감사 이벤트 append RPC — 부모 소유권을 auth.uid()로 확인하고 이벤트만 추가한다.
--    상태 전이가 아닌 "이력 기록" 용도(데모 시드·독촉 발송)에만 쓴다.
--    상태 전이는 여전히 *_with_event RPC가 도메인 UPDATE와 한 트랜잭션으로 처리한다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function append_contract_event(
  p_contract_id uuid,
  p_actor text,
  p_from_status text,
  p_to_status text,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_event_id uuid;
begin
  select user_id
  into v_user_id
  from contracts
  where id = p_contract_id
    and user_id = (select auth.uid())
    and deleted_at is null;

  if not found then
    raise exception 'contract not found';
  end if;

  insert into contract_events (
    user_id, contract_id, actor, from_status, to_status, event_type, meta
  )
  values (
    v_user_id, p_contract_id, p_actor, p_from_status, p_to_status, p_event_type,
    coalesce(p_meta, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function append_contract_event(uuid, text, text, text, text, jsonb)
  from public, anon;
grant execute on function append_contract_event(uuid, text, text, text, text, jsonb)
  to authenticated;

create or replace function append_invoice_event(
  p_invoice_id uuid,
  p_actor text,
  p_from_status text,
  p_to_status text,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_event_id uuid;
begin
  select user_id
  into v_user_id
  from invoices
  where id = p_invoice_id
    and user_id = (select auth.uid())
    and deleted_at is null;

  if not found then
    raise exception 'invoice not found';
  end if;

  insert into invoice_events (
    user_id, invoice_id, actor, from_status, to_status, event_type, meta
  )
  values (
    v_user_id, p_invoice_id, p_actor, p_from_status, p_to_status, p_event_type,
    coalesce(p_meta, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function append_invoice_event(uuid, text, text, text, text, jsonb)
  from public, anon;
grant execute on function append_invoice_event(uuid, text, text, text, text, jsonb)
  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 클라이언트 직접 쓰기 표면 제거
--    정책도 함께 지운다 — 권한이 없으면 정책은 무의미하지만, 남겨두면 "클라이언트가 쓸 수
--    있는 테이블"로 오독돼 다음 사람이 권한을 되돌릴 여지가 된다.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "contract_signatures_insert_own" on contract_signatures;
drop policy if exists "contract_events_insert_own" on contract_events;
drop policy if exists "invoice_events_insert_own" on invoice_events;

revoke insert on contract_signatures from anon, authenticated;
revoke insert on contract_events from anon, authenticated;
revoke insert on invoice_events from anon, authenticated;
revoke insert on signature_requests from anon, authenticated;

drop policy if exists "signature_requests_insert_own" on signature_requests;

-- 0037_contract_invoice_column_grants
-- OWASP 스캔 A08·A01(high/medium, 대시보드 #31·#6): contracts·invoices의 UPDATE 정책이
-- 컬럼 제한 없이 열려 있어 `PATCH /rest/v1/contracts?id=eq.<own>`으로 status·doc_hash·
-- signature_meta를, invoices로 payment_status·paid_at·금액 스냅샷을 직접 쓸 수 있었다.
-- Server Action의 zod allowlist와 *_with_event RPC(도메인 UPDATE + 이벤트 INSERT)를 통째로
-- 우회하므로 "이벤트 없는 상태 전이"가 만들어지고 기록 체인이 감사 불가능해진다.
--
-- 정책(user_id = auth.uid())은 "어느 행"만 제한할 뿐 "어느 컬럼"은 제한하지 못한다.
-- 그래서 컬럼 수준 grant로 좁힌다. 서버 소유 필드는 0035의 DEFINER RPC만 쓰게 된다.
--
-- 선행 조건은 0035에서 끝났고(상태 전이 RPC 전부 DEFINER), 남아 있던 직접 쓰기 2곳을
-- 아래 RPC로 옮긴다.
--
-- 이 마이그레이션이 다루지 않는 것: INSERT 컬럼 제한(신규 계약을 status='signed'로 바로
-- 만들 수 있는 자기 스코프 위조)과 is_demo 클라이언트 쓰기(대시보드 #32). 데모 시드 경로를
-- 함께 옮겨야 해서 별도 작업으로 분리한다.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) contracts.contract_pdf_url — PDF 생성 라우트가 쓰던 서버 소유 필드
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_contract_pdf_url(
  p_contract_id uuid,
  p_pdf_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract_id uuid;
begin
  if p_pdf_key is null or char_length(p_pdf_key) > 512 then
    raise exception 'invalid pdf key';
  end if;

  update contracts
  set contract_pdf_url = p_pdf_key
  where id = p_contract_id
    and user_id = (select auth.uid())
    and deleted_at is null
  returning id into v_contract_id;

  if not found then
    raise exception 'contract not found';
  end if;

  return v_contract_id;
end;
$$;

revoke all on function set_contract_pdf_url(uuid, text) from public, anon;
grant execute on function set_contract_pdf_url(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) invoices.contract_snapshot — 계약 물리삭제(ADR-008) 직전의 계약 요약
--    스냅샷 값을 클라이언트가 넘기지 않고 계약 행에서 서버가 직접 만든다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function snapshot_invoices_for_contract(p_contract_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
  v_updated integer;
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

  update invoices
  set contract_snapshot = jsonb_build_object(
        'title', v_contract.title,
        'amount', v_contract.amount,
        'start_date', v_contract.start_date,
        'end_date', v_contract.end_date
      )
  where contract_id = p_contract_id
    and user_id = v_contract.user_id;

  get diagnostics v_updated = row_count;

  return v_updated;
end;
$$;

revoke all on function snapshot_invoices_for_contract(uuid) from public, anon;
grant execute on function snapshot_invoices_for_contract(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) 컬럼 수준 UPDATE 권한
--    contracts: 사용자가 편집하는 도메인 필드만. status·doc_hash·signature_meta·
--      signature_image_path·contract_pdf_url·source_pdf_url·is_demo·user_id 제외.
--    invoices: 소프트 삭제만. 금액·세금 스냅샷과 결제 상태는 전부 RPC 소관.
-- ─────────────────────────────────────────────────────────────────────────────
revoke update on contracts from anon, authenticated;
grant update (title, scope, amount, start_date, end_date, clauses, plain_summary, client_id)
  on contracts to authenticated;

revoke update on invoices from anon, authenticated;
grant update (deleted_at) on invoices to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) 증거 테이블의 잔여 UPDATE 권한 회수
--    0036에서 INSERT는 닫았지만 UPDATE/DELETE grant가 남아 정책 부재로만 막히고 있었다.
--    contract_events·invoice_events의 DELETE는 데모 정리 정책이 쓰므로 남긴다.
-- ─────────────────────────────────────────────────────────────────────────────
revoke update on contract_signatures from anon, authenticated;
revoke update on contract_events from anon, authenticated;
revoke update on invoice_events from anon, authenticated;
revoke delete on contract_signatures from anon, authenticated;

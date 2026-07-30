-- 0039_demo_seed_rpc_insert_grants
-- OWASP 스캔 A08(medium, 대시보드 #32): is_demo가 클라이언트 쓰기 가능한 일반 컬럼이라
-- `PATCH /rest/v1/invoices {"is_demo": true}`로 실서비스 행을 데모로 승격한 뒤, 0007의
-- 데모 전용 물리삭제 정책으로 인보이스·감사 이벤트를 흔적 없이 지울 수 있었다.
-- (append-only 이벤트 로그와 soft-delete 보존이 동시에 무너진다)
--
-- 0037이 UPDATE 컬럼 권한을 좁히면서 contracts·invoices의 is_demo는 이미 막혔지만
--   - clients.is_demo는 아직 UPDATE 가능
--   - INSERT는 세 테이블 모두 컬럼 제한이 없어 처음부터 is_demo=true(또는 status='signed',
--     payment_status='paid')로 만들어 넣을 수 있다
-- 는 구멍이 남아 있었다. 여기서 INSERT 컬럼 권한까지 좁혀 마무리한다.
--
-- 선행 작업: 유일하게 is_demo를 정당하게 쓰던 경로(데모 시드)를 DEFINER RPC로 옮긴다.
-- 시드 값은 전부 서버(이 함수) 소유가 되고, 클라이언트는 "데모를 채워줘"만 요청한다.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 데모 시드 RPC — 호출자(auth.uid()) 계정에 데모 3종 + 감사 이벤트를 만든다.
--    이미 데모 클라이언트가 있으면 아무것도 하지 않는다(멱등).
--    금액 스냅샷은 calcWithholding(3,000,000, 'wt_3_3') 결과와 같은 고정 픽스처 값이다
--    (세금 로직을 SQL에 복제하지 않기 위해 계산이 아니라 상수로 둔다).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function seed_demo_data()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_client_id uuid;
  v_contract_id uuid;
  v_invoice_id uuid;
  v_clauses constant jsonb := '[
    {
      "title": "업무 범위",
      "body": "김하나는 무디의 브랜드 로고 리뉴얼과 인스타그램 템플릿 5종 제작 업무를 수행한다.",
      "plain_summary": "로고와 인스타 템플릿 5개를 3주 안에 만든다는 뜻입니다.",
      "needs_review": false
    },
    {
      "title": "대금 및 지급",
      "body": "무디는 본 계약의 대가로 총 3,000,000원을 지급하며, 인보이스에 명시된 지급기한까지 입금한다.",
      "plain_summary": "총 대금은 300만원이고 청구서 기한까지 입금합니다.",
      "needs_review": false
    },
    {
      "title": "저작권 및 사용권",
      "body": "최종 산출물의 사용 범위와 원본 파일 제공 여부는 당사자 간 별도 합의에 따른다.",
      "plain_summary": "산출물을 어디까지 쓸 수 있는지는 별도 확인이 필요합니다.",
      "needs_review": true
    }
  ]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  -- 멱등: 이미 데모가 있으면 중복 생성하지 않는다.
  if exists (
    select 1 from clients
    where user_id = v_user_id and is_demo = true and deleted_at is null
  ) then
    return false;
  end if;

  insert into clients (user_id, name, channel, contact_email, memo, is_demo)
  values (
    v_user_id, '무디', 'instagram', 'hello@moodi.example',
    '인스타그램 DM으로 문의한 카페 브랜드', true
  )
  returning id into v_client_id;

  insert into contracts (
    user_id, client_id, title, scope, amount, start_date, end_date,
    status, clauses, is_demo
  )
  values (
    v_user_id, v_client_id, '무디 브랜드 리뉴얼',
    '브랜드 로고 리뉴얼 + 인스타 템플릿 5종', 3000000,
    '2026-07-01', '2026-07-21', 'signed', v_clauses, true
  )
  returning id into v_contract_id;

  insert into invoices (
    user_id, contract_id, client_id, amount, issue_date, due_date,
    withholding_type, withholding_amount, net_amount,
    payment_status, paid_at, payment_method, is_demo
  )
  values (
    v_user_id, v_contract_id, v_client_id, 3000000, '2026-07-22', '2026-08-05',
    'wt_3_3', 99000, 2901000,
    'paid', '2026-08-05T09:00:00+09:00', 'bank_transfer', true
  )
  returning id into v_invoice_id;

  insert into contract_events (
    user_id, contract_id, actor, from_status, to_status, event_type, meta
  )
  values (
    v_user_id, v_contract_id, v_user_id::text, null, 'signed',
    'contract.demo_seeded', jsonb_build_object('client_id', v_client_id)
  );

  insert into invoice_events (
    user_id, invoice_id, actor, from_status, to_status, event_type, meta
  )
  values (
    v_user_id, v_invoice_id, v_user_id::text, null, 'paid',
    'invoice.demo_seeded',
    jsonb_build_object(
      'contract_id', v_contract_id,
      'client_id', v_client_id,
      'payment_method', 'bank_transfer'
    )
  );

  return true;
end;
$$;

revoke all on function seed_demo_data() from public, anon;
grant execute on function seed_demo_data() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) INSERT 컬럼 권한 — 서버 소유 필드를 클라이언트 INSERT 표면에서 제외한다.
--    clients : is_demo 제외
--    contracts: is_demo·status·doc_hash·signature_meta·signature_image_path·
--               contract_pdf_url·source_pdf_url 제외 (전부 RPC 소관)
--    invoices : 직접 INSERT 경로가 없다(발행은 issue_invoice_with_event, 반복은 크론 RPC,
--               데모는 위 seed_demo_data — 모두 DEFINER). 권한 자체를 회수한다.
-- ─────────────────────────────────────────────────────────────────────────────
revoke insert on clients from anon, authenticated;
grant insert (user_id, name, channel, contact_email, contact_phone, memo)
  on clients to authenticated;

revoke insert on contracts from anon, authenticated;
grant insert (user_id, client_id, title, scope, amount, start_date, end_date, clauses, plain_summary)
  on contracts to authenticated;

revoke insert on invoices from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) clients UPDATE 컬럼 권한 — 0037이 contracts·invoices만 다뤘다.
--    is_demo가 열려 있으면 실 클라이언트를 데모로 승격해 물리삭제(0007)할 수 있다.
-- ─────────────────────────────────────────────────────────────────────────────
revoke update on clients from anon, authenticated;
grant update (name, channel, contact_email, contact_phone, memo, deleted_at)
  on clients to authenticated;

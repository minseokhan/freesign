-- 0046_invoice_share_tokens
-- 청구 전달 경로 — 클라이언트가 로그인 없이 인보이스를 열람·다운로드하는 공개 토큰 표면.
--
-- 문제: 인보이스 "발행"이 payment_status draft→unpaid 전이와 invoice.issued 이벤트만
-- 남겼고, 클라이언트에게 나가는 경로가 없었다. 사용자는 PDF를 내려받아 앱 밖(메일·카톡)으로
-- 직접 보내야 했고, 그 순간 "언제 청구했는지"가 기록 체인에서 빠졌다. 방어 코어가
-- "계약 → 지급기한 → 입금/미수 증빙"인 제품에서 체인의 중간 한 마디가 앱 밖에 있던 셈이다.
--
-- 설계: signature_requests(0018)·get_signing_session(0019)의 공개 토큰 패턴을 그대로 따른다.
--   - 원문 토큰 미저장(sha256 해시만) → 재발송은 반드시 재발급
--   - 인보이스당 활성 토큰 1개(부분 unique index)
--   - 쓰기는 DEFINER RPC만. 클라이언트에는 SELECT만 연다(0036 락다운 방침)
--   - anon 공개 열람은 anon-grant DEFINER 함수로만(테이블 권한 없음)
--
-- 만료(D1): 앱이 due_date + 90일(최소 now+30일)로 계산해 넘긴다. 서명 토큰의 14일은
-- 연체 독촉 시점에 이미 죽어 링크가 무용지물이 되므로 쓰지 않는다. RPC는 상한(400일)만 검증한다.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invoice_share_status') then
    create type invoice_share_status as enum ('active', 'revoked');
  end if;
end
$$;

create table invoice_share_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  invoice_id uuid not null references invoices(id) on delete cascade,
  token_hash text not null unique check (
    char_length(token_hash) between 32 and 128
  ),
  -- 클라이언트 contact_email은 nullable이므로(0001) 이메일 없이 링크만 발급하는 경우를 허용한다.
  recipient_email text check (
    recipient_email is null or char_length(recipient_email) between 3 and 320
  ),
  status invoice_share_status not null default 'active',
  expires_at timestamptz not null,
  first_viewed_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- 인보이스당 활성 토큰 1개 (signature_requests_one_pending_per_contract와 동형).
create unique index invoice_share_tokens_one_active_per_invoice
  on invoice_share_tokens (invoice_id)
  where status = 'active';

create index invoice_share_tokens_owner_invoice
  on invoice_share_tokens (user_id, invoice_id);

-- 성능 advisor: user_id FK 커버링 인덱스는 위 복합 인덱스의 선두 컬럼으로 충족된다.

alter table invoice_share_tokens enable row level security;

-- 소유자 UI(발송 여부·열람 시각 표시)를 위한 읽기만 연다.
-- INSERT·UPDATE·DELETE 권한과 정책은 두지 않는다 — 쓰기는 아래 DEFINER RPC로만.
create policy "invoice_share_tokens_select_own"
  on invoice_share_tokens
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on invoice_share_tokens from anon, authenticated;
revoke all on invoice_share_tokens from anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) send_invoice_with_event — SECURITY DEFINER, authenticated 전용, 소유자 스코프.
--
--    쓰기 순서: 기존 토큰 revoke → 새 토큰 INSERT → payment_status 전이 → 이벤트 INSERT.
--    status 변경을 앞쪽에 두지 않는다(CLAUDE.md: 부분 실패 시 미완 방지).
--
--    draft일 때만 unpaid로 전이하고 invoice.issued를 남긴다. 이미 unpaid면 재발송으로 보고
--    토큰만 교체한다(전이·이벤트 없음). 실제 도달 증거인 invoice.sent는 메일 발송이
--    성공한 뒤 앱이 append_invoice_event(0036)로 따로 남긴다 — 커밋 시점에 미리 남기면
--    "보냈다고 기록됐는데 안 간" 상태가 증거로 굳는다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function send_invoice_with_event(
  p_invoice_id uuid,
  p_token_hash text,
  p_recipient_email text,
  p_expires_at timestamptz,
  p_actor text,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice invoices%rowtype;
  v_issued boolean := false;
begin
  if p_token_hash is null
    or char_length(p_token_hash) < 32
    or char_length(p_token_hash) > 128
  then
    raise exception 'invalid token hash';
  end if;

  if p_expires_at is null
    or p_expires_at <= now()
    or p_expires_at > now() + interval '400 days'
  then
    raise exception 'invalid expiry';
  end if;

  if p_recipient_email is not null
    and (char_length(p_recipient_email) < 3 or char_length(p_recipient_email) > 320)
  then
    raise exception 'invalid recipient email';
  end if;

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

  if v_invoice.payment_status = 'paid' then
    raise exception 'invoice already settled';
  end if;

  update invoice_share_tokens
  set status = 'revoked'
  where invoice_id = p_invoice_id
    and status = 'active';

  insert into invoice_share_tokens (
    user_id,
    invoice_id,
    token_hash,
    recipient_email,
    expires_at,
    last_sent_at
  )
  values (
    v_invoice.user_id,
    p_invoice_id,
    p_token_hash,
    p_recipient_email,
    p_expires_at,
    now()
  );

  if v_invoice.payment_status = 'draft' then
    update invoices
    set payment_status = 'unpaid'
    where id = p_invoice_id;

    insert into invoice_events (
      user_id, invoice_id, actor, from_status, to_status, event_type, meta
    )
    values (
      v_invoice.user_id,
      p_invoice_id,
      p_actor,
      'draft',
      'unpaid',
      'invoice.issued',
      coalesce(p_meta, '{}'::jsonb)
    );

    v_issued := true;
  end if;

  return jsonb_build_object('issued', v_issued);
end;
$$;

revoke all on function send_invoice_with_event(uuid, text, text, timestamptz, text, jsonb)
  from public, anon;
grant execute on function send_invoice_with_event(uuid, text, text, timestamptz, text, jsonb)
  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) get_invoice_view — SECURITY DEFINER, anon 전용.
--
--    토큰 소지자에게 인보이스 열람·PDF 렌더에 필요한 필드만 반환한다.
--    반환 금지: user_id — 소유자 식별자는 이 표면에서 쓸 데가 없다.
--    invoice_id는 반환한다: PDF의 문서번호가 인보이스 id라, 클라이언트가 받은 청구서와
--    소유자가 보관한 청구서의 번호가 같아야 대조가 된다. 소유자 라우트는 세션+RLS로
--    막히므로 id를 알아도 열람 권한이 생기지 않는다.
--    계좌 정보는 청구 목적상 상대에게 알려야 하는 정보이므로 포함한다(D2-A).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function get_invoice_view(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token invoice_share_tokens%rowtype;
  v_invoice invoices%rowtype;
  v_client_name text;
  v_contract_title text;
  v_sender_name text;
  v_profile profiles%rowtype;
begin
  if p_token_hash is null
    or char_length(p_token_hash) < 32
    or char_length(p_token_hash) > 128
  then
    return null;
  end if;

  select *
  into v_token
  from invoice_share_tokens
  where token_hash = p_token_hash
  for update;

  if not found then
    return null;
  end if;

  if v_token.status = 'revoked' then
    return jsonb_build_object('state', 'revoked');
  end if;

  if v_token.expires_at <= now() then
    return jsonb_build_object('state', 'expired');
  end if;

  select *
  into v_invoice
  from invoices
  where id = v_token.invoice_id
    and deleted_at is null;

  if not found then
    return jsonb_build_object('state', 'revoked');
  end if;

  if v_token.first_viewed_at is null then
    update invoice_share_tokens
    set first_viewed_at = now()
    where id = v_token.id;
  end if;

  select name
  into v_client_name
  from clients
  where id = v_invoice.client_id;

  -- 계약이 물리 삭제된 인보이스(ADR-008)는 contract_id가 NULL이고 스냅샷만 남는다.
  select title
  into v_contract_title
  from contracts
  where id = v_invoice.contract_id;

  v_contract_title := coalesce(
    v_contract_title,
    v_invoice.contract_snapshot->>'title',
    '(제목 없음)'
  );

  select coalesce(p.display_name, u.email)
  into v_sender_name
  from auth.users u
  left join profiles p on p.user_id = u.id
  where u.id = v_invoice.user_id;

  select *
  into v_profile
  from profiles
  where user_id = v_invoice.user_id;

  return jsonb_build_object(
    'state', 'active',
    'invoice_id', v_invoice.id,
    'payment_status', v_invoice.payment_status,
    'amount', v_invoice.amount,
    'withholding_type', v_invoice.withholding_type,
    'withholding_amount', v_invoice.withholding_amount,
    'net_amount', v_invoice.net_amount,
    'issue_date', v_invoice.issue_date,
    'due_date', v_invoice.due_date,
    'paid_at', v_invoice.paid_at,
    'contract_title', v_contract_title,
    'client_name', v_client_name,
    'sender_name', v_sender_name,
    'bank_name', v_profile.bank_name,
    'bank_account_number', v_profile.bank_account_number,
    'bank_account_holder', v_profile.bank_account_holder,
    'expires_at', v_token.expires_at
  );
end;
$$;

revoke all on function get_invoice_view(text) from public, authenticated;
grant execute on function get_invoice_view(text) to anon;

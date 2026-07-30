-- 0032_owasp_rls_hardening
-- OWASP Top 10:2025 스캔(A01·A06) 확정 항목 중 "DB 계층에서 닫을 수 있는" 것들을 고친다.
--
-- 고치는 결함:
--   1) signature_requests INSERT/UPDATE 정책이 user_id만 보고 부모 계약 소유권을 보지 않아
--      남의 contract_id를 가리키는 서명요청 행을 위조/재지정할 수 있었다(critical).
--   2) contract_signatures·contract_events INSERT 정책도 같은 결함 — 타인 계약에 증거·감사 행 주입.
--   3) usage_counters를 클라이언트가 직접 UPDATE해 Free 누적 쿼터를 리셋할 수 있었다.
--   4) rate_limit_events를 클라이언트가 직접 DELETE해 레이트리밋을 우회할 수 있었다.
--
-- 설계 원칙(CLAUDE.md):
--   * FK 참조(자식 → 부모)는 RLS를 우회하므로 WITH CHECK에서 부모 소유권을 직접 확인한다
--     (0007_demo_delete_policies.sql의 exists(...) 패턴과 동일).
--   * 서버 소유 필드(status 등)와 남용 방어 카운터는 클라이언트 쓰기 대상이 아니다 →
--     테이블 권한을 회수하고 auth.uid()로 스코프된 SECURITY DEFINER RPC로만 쓴다.
--   * 정책을 조이되, 애플리케이션의 정상 경로(SECURITY INVOKER RPC·Server Action)는
--     그대로 통과해야 한다. 그래서 signature_requests/contract_signatures/contract_events는
--     revoke가 아니라 정책 강화로 닫는다(아래 주석 참조).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) signature_requests — 부모 계약 소유권 + status 고정
--
-- INSERT 권한 자체를 회수하지 않는 이유: 발송 RPC(send_signature_request_with_event, 0022)가
-- SECURITY INVOKER라 이 INSERT는 호출자 권한 + 호출자 RLS로 수행된다. revoke하면 정상 발송이
-- 깨진다. 대신 "내 계약에, pending으로만" 삽입 가능하도록 WITH CHECK를 좁힌다.
-- status를 고정하면 PostgREST 직접 삽입으로 completed 요청을 위조해 anon 교부 라우트
-- (/api/sign/{token}/pdf·certificate)를 여는 경로가 막힌다.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "signature_requests_insert_own" on signature_requests;

create policy "signature_requests_insert_own"
  on signature_requests
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1
      from contracts c
      where c.id = signature_requests.contract_id
        and c.user_id = (select auth.uid())
    )
  );

-- UPDATE에도 같은 가드가 필요하다. 이게 없으면 "내 계약으로 pending 삽입 → contract_id를
-- 피해자 계약으로 재지정 / status를 completed로 승격"이라는 우회가 그대로 남는다.
-- 정상 경로(발송 TSA 토큰 저장·재발송 시 token_hash/expires_at 갱신)는 모두 pending 행을
-- 대상으로 하고 contract_id를 바꾸지 않으므로 영향받지 않는다.
-- completed/revoked 전이는 DEFINER RPC(complete_*·revoke_*·store_completion_tsa_token)가 담당한다.
drop policy if exists "signature_requests_update_own" on signature_requests;

create policy "signature_requests_update_own"
  on signature_requests
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from contracts c
      where c.id = signature_requests.contract_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1
      from contracts c
      where c.id = signature_requests.contract_id
        and c.user_id = (select auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) contract_signatures — 부모 계약 소유권
--
-- 이 행은 삭제 차단 트리거(block_contract_delete_with_counterparty_signature, DEFINER)와
-- 완결증명서 집계(get_certificate_data, DEFINER)가 RLS 없이 읽는다. 타인 계약에 party
-- ='counterparty' 행을 주입하면 피해자가 자기 계약을 영구히 삭제할 수 없게 되고(크로스 테넌트 DoS)
-- 증명서 증거가 오염된다. 여기서도 INSERT 권한은 남긴다 — 발송 RPC가 INVOKER이기 때문.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "contract_signatures_insert_own" on contract_signatures;

create policy "contract_signatures_insert_own"
  on contract_signatures
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from contracts c
      where c.id = contract_signatures.contract_id
        and c.user_id = (select auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) contract_events — 부모 계약 소유권
--
-- 감사 로그에 위조 행을 넣으면 anon 완결증명서 타임라인에 공격자가 만든 actor·시각이 실린다.
-- 정상 경로: 0012·0019·0022의 *_with_event RPC(INVOKER)와 데모 시드 Server Action이
-- 모두 자기 계약에 대해 INSERT하므로 통과한다.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "contract_events_insert_own" on contract_events;

create policy "contract_events_insert_own"
  on contract_events
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from contracts c
      where c.id = contract_events.contract_id
        and c.user_id = (select auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) usage_counters — 과금 경계 카운터를 클라이언트 쓰기 대상에서 제외
--
-- Free 누적 상한(불러오기 AI 파싱 5회)의 유일한 판정 근거인데, 본인 행 UPDATE가 열려 있어
-- `PATCH /rest/v1/usage_counters {"used": 0}` 한 번으로 오도미터를 리셋할 수 있었다.
-- 잔여 사용량 표시를 위해 SELECT(정책·권한)만 남기고 쓰기는 DEFINER RPC로만.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "usage_counters_insert_own" on usage_counters;
drop policy if exists "usage_counters_update_own" on usage_counters;

revoke insert, update, delete on usage_counters from anon, authenticated;

-- consume_lifetime_quota를 SECURITY DEFINER로 전환한다(본문·시그니처·반환형은 0024와 동일).
-- caller 권한이 아니라 함수 소유자 권한으로 카운터를 증가시키므로 테이블 권한을 회수해도 동작한다.
-- 대상 행은 여전히 클라이언트 입력이 아니라 auth.uid()로만 특정한다(권한상승 없음).
create or replace function consume_lifetime_quota(
  p_bucket text,
  p_max integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_used integer;
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'used', 0, 'max', p_max);
  end if;

  select used into v_used
  from usage_counters
  where user_id = v_uid and bucket = p_bucket;

  v_used := coalesce(v_used, 0);

  if v_used >= p_max then
    return jsonb_build_object('allowed', false, 'used', v_used, 'max', p_max);
  end if;

  insert into usage_counters (user_id, bucket, used)
  values (v_uid, p_bucket, 1)
  on conflict (user_id, bucket)
  do update set used = usage_counters.used + 1, updated_at = now();

  return jsonb_build_object(
    'allowed', true,
    'used', v_used + 1,
    'max', p_max,
    'remaining', p_max - v_used - 1
  );
end;
$$;

-- DEFINER가 됐으므로 역할 경계를 0021·0025 관례대로 다시 못박는다(create or replace는 ACL 유지).
revoke all on function consume_lifetime_quota(text, integer) from public, anon;
grant execute on function consume_lifetime_quota(text, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) rate_limit_events — 남용 방어 상태를 제한 대상 본인에게서 떼어낸다
--
-- delete_own 정책 때문에 `DELETE /rest/v1/rate_limit_events?user_id=eq.<self>` 한 번으로
-- 슬라이딩 윈도우를 비우고 AI 초안·PDF 파싱·서명 발송 상한을 무력화할 수 있었다.
-- 0018의 anon_rate_limit_events(정책 없음 + DEFINER 함수만 접근) 구조에 맞춘다.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "rate_limit_events_select_own" on rate_limit_events;
drop policy if exists "rate_limit_events_insert_own" on rate_limit_events;
drop policy if exists "rate_limit_events_delete_own" on rate_limit_events;

revoke all on rate_limit_events from anon, authenticated;

-- consume_rate_limit도 SECURITY DEFINER로 전환(본문·시그니처·반환형은 0014와 동일,
-- search_path는 0015에서 고정한 값을 그대로 명시). 윈도우 정리 DELETE도 함수 내부에서만 일어난다.
create or replace function consume_rate_limit(
  p_bucket text,
  p_max integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
  v_oldest timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'retry_after', p_window_seconds);
  end if;

  -- 윈도우 밖 이벤트 정리(해당 사용자·버킷)
  delete from rate_limit_events
  where user_id = v_uid
    and bucket = p_bucket
    and created_at < now() - make_interval(secs => p_window_seconds);

  select count(*), min(created_at)
  into v_count, v_oldest
  from rate_limit_events
  where user_id = v_uid
    and bucket = p_bucket;

  if v_count >= p_max then
    return jsonb_build_object(
      'allowed', false,
      'retry_after', greatest(
        1,
        ceil(extract(epoch from (v_oldest + make_interval(secs => p_window_seconds) - now())))
      )
    );
  end if;

  insert into rate_limit_events (user_id, bucket) values (v_uid, p_bucket);

  return jsonb_build_object('allowed', true, 'remaining', p_max - v_count - 1);
end;
$$;

revoke all on function consume_rate_limit(text, integer, integer) from public, anon;
grant execute on function consume_rate_limit(text, integer, integer) to authenticated;

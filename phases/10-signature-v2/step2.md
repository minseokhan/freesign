# Step 2: rpc-migration

쌍방 서명의 트랜잭션 경계: 발송·열람·완결·철회 RPC와 anon 접근 표면. 이 step은 **마이그레이션 SQL + embedded-postgres 테스트만** 다룬다.

## 읽어야 할 파일

- `/docs/SIGNATURE_V2_PLAN.md` — §2(anon 접근·서명 순서·증거 보존 행), §3 Step 2의 RPC 5종 명세, §4 리스크 1(DEFINER 공격 표면)
- `/CLAUDE.md` — 상태 전이는 append-only 이벤트 로그와 함께(도메인 UPDATE 후 이벤트 INSERT), service_role 요청 경로 금지
- `supabase/migrations/0012_domain_event_functions.sql` — **1차 레퍼런스**: `*_with_event` RPC 패턴(search_path 고정·revoke·grant·이벤트 INSERT 순서)
- `supabase/migrations/0018_mutual_signature.sql` — step 1이 만든 테이블·트리거·`consume_anon_rate_limit`
- `supabase/migrations/0015_advisor_security_fixes.sql` — 함수 보안 하드닝 관례
- `src/test/__tests__/` 하위 기존 RPC/RLS 테스트 — 테스트 셋업(유저 생성·계약 시드) 패턴
- 이전 step 산출물: `src/lib/contract-status.ts`(전이 규칙과 DB 가드가 일치해야 함)

## 작업

신규 `supabase/migrations/0019_signature_rpcs.sql`. 모든 함수 공통: `set search_path = public, pg_temp` 고정, `revoke all on function ... from public`, 필요한 롤에만 grant. anon-grant 함수는 **입력 길이 상한 검증**과 **반환 필드 최소화**를 지켜라(리스크 §4-1).

### 1) `send_signature_request_with_event(...)` — SECURITY INVOKER, grant authenticated

원자적으로: 계약이 호출자 소유·`draft` 검증 → contracts에 owner 서명 필드 기록(기존 sign route가 쓰는 컬럼과 동일: signature_image_path, doc_hash, signature_meta 등 — 기존 sign route 구현을 읽고 일치시켜라) → `contract_signatures`(party=owner) INSERT → `signature_requests`(pending, frozen_doc_hash, expires_at=14일) INSERT → contracts `draft→sent` → 이벤트 `signature_request.sent` INSERT. 실패 시 전체 롤백.

### 2) `get_signing_session(p_token_hash text)` — SECURITY DEFINER, grant anon

상태별 최소 필드 jsonb 반환:
- 토큰 불일치/무효 → `null`
- 만료·철회 → `{ state: 'expired' | 'revoked' }` 만
- pending 유효 → 계약 열람에 필요한 최소 필드(계약 제목·조항 jsonb·frozen_doc_hash·수신자명·발신자(소유자) 표시명·expires_at·state)
- completed → `{ state: 'completed' }` + 다운로드 안내용 최소 필드
- pending 유효 시 `first_viewed_at`이 **null일 때만 1회** 기록 + `signature_request.viewed` 이벤트 INSERT

### 3) `complete_counterparty_signature_with_event(...)` — SECURITY DEFINER, grant anon

단일 트랜잭션: `signature_requests` 행 `FOR UPDATE` 잠금 → pending·미만료·계약 status=`sent`·**현재 계약 doc_hash == frozen_doc_hash** 검증(하나라도 실패 시 구분 가능한 에러코드로 raise) → `contract_signatures`(party=counterparty, signature_image_data, signer_email/name, consent, meta에 ip/ua) INSERT → request `completed`(completed_at) → contracts `sent→signed` → 이벤트 `contract.counterparty_signed`(actor `counterparty:<email>`, meta에 ip/ua/consent). 1회성은 status=pending 검증으로 보장. 반환: 완료 알림 발송에 필요한 값(owner 이메일 조회 포함, request id, contract id·제목 등 최소 필드).

### 4) `revoke_signature_request_with_event(...)` — SECURITY INVOKER, grant authenticated

소유·pending 검증 → request `revoked` → contracts `sent→draft` + owner 서명 아티팩트 리셋(기존 signed→draft 리셋이 지우는 컬럼과 동일하게 — 0012의 transition 함수 구현 참고) → `contract_signatures`의 해당 owner 행 DELETE(counterparty 행은 존재할 수 없는 상태) → 이벤트 INSERT.

### 5) `get_certificate_data(p_token_hash text)` — SECURITY DEFINER, grant anon

completed 요청의 토큰 소지자에게 완결증명서 데이터 반환: 계약(제목·조항·doc_hash), 서명 2건(party·이름·이메일·시각·consent·meta), 관련 contract_events 타임라인, TSA 토큰 2종. completed가 아니면 null. step 7·8에서 사용된다.

### 6) 기존 `transition_contract_status_with_event` 수정

`to_status = 'draft'`이고 해당 계약에 counterparty 서명 행이 존재하면 `raise exception` (DB 이중 가드 — 앱 레이어 가드는 step 9).

`CREATE OR REPLACE`로 수정하되 0012 원본 파일을 편집하지 말고 0019에 재정의를 넣어라.

### 7) `src/types/database.ts` 재생성

step 1과 같은 방법으로 Functions 시그니처 반영.

## TDD (테스트 먼저 작성)

신규 `src/test/__tests__/signature-rpcs.test.ts` (기존 테스트의 유저·계약 시드 헬퍼 재사용):

1. `send_...`: draft 계약에서 성공 → contracts=sent + owner 서명행 + pending 요청 + 이벤트 존재. draft 아닌 계약·비소유 계약 실패
2. `get_signing_session`: 유효/만료/철회/오토큰 4분기 반환 형태. 첫 호출만 first_viewed_at 기록(2회 호출해 불변 확인) + viewed 이벤트 1건
3. `complete_...`: 정상 → signed + counterparty 행 + completed + 이벤트(actor·meta). **이중 완료 실패**. **frozen_doc_hash 불일치 실패**(완결 전 계약 조항 UPDATE로 재현). 만료 실패
4. `revoke_...`: pending 철회 → draft 복귀 + 아티팩트 리셋. completed 요청 철회 실패
5. `transition_..._with_event`: counterparty 서명 존재 시 to=draft raise
6. anon 롤로 두 테이블 직접 SELECT 불가하지만 DEFINER RPC는 동작(경계 확인)

## Acceptance Criteria

```bash
npm run lint
npm test
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 모든 함수에 `search_path = public, pg_temp` 고정 + `revoke from public`이 있는가?
   - anon-grant 함수가 최소 필드만 반환하고 입력 길이를 검증하는가?
   - 이벤트 INSERT가 도메인 UPDATE **뒤**에 오는가(CLAUDE.md 순서 규칙)?
   - 원격 반영을 시도하지 않았는가?
3. 결과에 따라 `phases/10-signature-v2/index.json`의 step 2를 업데이트한다 (성공: completed+summary / 3회 실패: error+error_message / 개입 필요: blocked+blocked_reason 후 중단).

## 금지사항

- Node/TypeScript 앱 코드(Server Action·route)를 만들지 마라. 이유: step 5·8 소관.
- anon에게 테이블 직접 정책을 추가하지 마라. 이유: anon 표면은 DEFINER RPC 몇 개로 국한이 확정 결정.
- `complete_...`에서 검증을 앱 레이어에 맡기고 생략하지 마라. 이유: RPC 단일 호출이 TOCTOU 제거의 핵심 — 검증·INSERT·전이가 한 트랜잭션이어야 한다.
- TSA 토큰 저장을 RPC 트랜잭션 안에 넣지 마라. 이유: TSA는 커밋 후 best-effort UPDATE(step 5·8) — 외부 HTTP를 DB 트랜잭션에 묶으면 안 된다.
- 기존 테스트를 깨뜨리지 마라.

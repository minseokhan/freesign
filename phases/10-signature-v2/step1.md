# Step 1: schema-migration

쌍방 서명의 DB 스키마: `sent` enum 값, `signature_requests`·`contract_signatures` 테이블, RLS, 삭제 차단 트리거, anon 레이트리밋 테이블. **RPC 함수는 이 step 범위가 아니다(step 2 소관).**

## 읽어야 할 파일

- `/docs/SIGNATURE_V2_PLAN.md` — §2 핵심 설계 결정(서명 복수화·상대 서명 이미지 DB 저장·증거 보존·토큰 행), §3 Step 2 중 스키마 부분
- `/docs/DATABASE.md` — 기존 테이블·RLS 관례
- `/CLAUDE.md` — RLS `USING` + `WITH CHECK (user_id = (select auth.uid()))` 둘 다 필수 규칙
- `supabase/migrations/0001_schema.sql`, `0002_rls.sql` — 테이블·RLS 작성 스타일
- `supabase/migrations/0014_rate_limits.sql` — 기존 `rate_limit_events` 구조(user_id NOT NULL이라 anon용 별도 테이블이 필요한 이유)
- `supabase/migrations/0013_contract_hard_delete.sql` — 계약 물리삭제 구조(트리거가 막아야 할 DELETE 경로)
- `src/test/pg.ts` — 테스트 하네스가 마이그레이션을 **파일별 개별 쿼리로 적용**하는 방식(118행 부근). enum ADD VALUE가 단독 파일이어야 하는 이유.
- `src/test/__tests__/schema.test.ts`, `src/test/__tests__/rls.test.ts` — embedded-postgres 테스트 패턴
- 이전 step 산출물: `src/lib/signing-token.ts`, 수정된 `src/lib/contract-status.ts`

## 작업

### 1) 신규 `supabase/migrations/0017_contract_status_sent.sql` — **단독 파일**

```sql
alter type contract_status add value if not exists 'sent' after 'draft';
```

다른 어떤 문장도 이 파일에 넣지 마라. 이유: Postgres는 enum ADD VALUE를 같은 트랜잭션 내 사용과 함께 못 쓰며, 테스트 하네스가 파일 단위로 적용하므로 분리해야 안전하다.

### 2) 신규 `supabase/migrations/0018_mutual_signature.sql`

**`signature_requests`** — 서명 요청(토큰) 테이블:
- `id uuid pk`, `user_id`(계약 소유자, auth.users 참조), `contract_id`(contracts 참조 **ON DELETE CASCADE** — 미서명 요청은 계약과 함께 소멸), `token_hash text unique not null`, `recipient_email text not null`, `recipient_name text`, `status` enum(`pending`/`completed`/`revoked`), `frozen_doc_hash text not null`, `expires_at timestamptz not null`, `first_viewed_at timestamptz`, `completed_at timestamptz`, `sent_tsa_token text`, `completion_tsa_token text`, `created_at`
- partial unique index: `(contract_id) where status = 'pending'` — 계약당 pending 요청 1건
- 입력 길이 상한 CHECK: recipient_email·recipient_name 등 text 필드에 합리적 길이 제한(공개 표면 방어)

**`contract_signatures`** — 서명 증거 테이블(불변):
- `id uuid pk`, `user_id`(계약 소유자 스코프), `contract_id`(contracts 참조 CASCADE), `request_id`(signature_requests 참조, nullable — owner 단독 서명 행엔 없음), `party` enum(`owner`/`counterparty`), `signer_email text`, `signer_name text`, `signature_image_path text`(owner: Storage key), `signature_image_data text`(counterparty: base64 PNG), `doc_hash text not null`, `consent jsonb`, `meta jsonb`, `signed_at timestamptz not null default now()`
- CHECK: `signature_image_path`와 `signature_image_data`는 **XOR**(정확히 하나만 non-null), `signature_image_data` 길이 ≤ 256KB (`octet_length` 기준)
- **update/delete RLS 정책을 만들지 않는다** = DB 수준 불변 증거

**RLS** — 두 테이블 모두:
- `enable row level security`
- owner-only: `to authenticated`, SELECT/INSERT에 `USING`·`WITH CHECK` 둘 다 `user_id = (select auth.uid())` (기존 0002_rls.sql·0015 스타일 준수)
- `signature_requests`는 owner의 UPDATE(철회 등) 정책 허용, `contract_signatures`는 SELECT/INSERT만
- **anon 정책은 만들지 않는다** — anon 접근은 step 2의 SECURITY DEFINER RPC 경유만

**트리거** — counterparty 서명 증거 보존:
- `contracts` BEFORE DELETE 트리거: 해당 계약에 `party = 'counterparty'` 서명 행이 존재하면 `raise exception`. owner 서명만 있으면 삭제 허용(기존 물리삭제 정책 유지).

**anon 레이트리밋**:
- `anon_rate_limit_events` 테이블(`ip_hash text`, `bucket text`, `created_at`) + 조회용 인덱스. RLS enable, 정책 없음(DEFINER 함수 경유만).
- `consume_anon_rate_limit(p_ip_hash text, p_bucket text, p_limit int, p_window_seconds int) returns boolean` — SECURITY DEFINER, `set search_path = public, pg_temp`, `revoke all ... from public` 후 `grant execute to anon`. 윈도우 내 카운트가 limit 미만이면 INSERT 후 true, 아니면 false.

### 3) `src/types/database.ts` 재생성

- 기존 재생성 방법을 먼저 확인하라: `package.json` scripts, 이전 마이그레이션 커밋(`git log --oneline -- src/types/database.ts` 후 해당 커밋 diff) 참고. 로컬 supabase가 없으면 기존 파일 스타일에 맞춰 수동 반영도 허용(테이블 Row/Insert/Update + enum 추가).
- step 0에서 `contract-status.ts`에 남긴 캐스팅/TODO가 있으면 이 시점에 제거 가능한지 확인.

### 4) 원격 미반영 주의

원격 Supabase에는 git 커밋만으로 반영되지 않는다(MCP `apply_migration` 수동 필요). 이 step에서는 **로컬 마이그레이션 파일 + 타입만** 작업하고, 원격 반영은 phase 완료 후 사용자가 한다. 원격 반영을 시도하지 마라.

## TDD (테스트 먼저 작성)

신규 `src/test/__tests__/mutual-signature-schema.test.ts` (기존 schema.test.ts·rls.test.ts 패턴 미러링):

1. 두 테이블 존재·핵심 컬럼 타입 확인
2. RLS: 다른 user로는 signature_requests/contract_signatures SELECT 불가, anon 롤로 직접 SELECT 불가
3. `contract_signatures` UPDATE/DELETE가 owner 본인이어도 거부됨(정책 부재)
4. XOR CHECK: path·data 둘 다 있거나 둘 다 없으면 INSERT 실패
5. partial unique: 같은 계약에 pending 요청 2건째 INSERT 실패
6. 삭제 트리거: counterparty 서명 행이 있는 계약 DELETE가 raise, owner 서명만 있으면 삭제 성공
7. `consume_anon_rate_limit`: limit 내 true, 초과 시 false, 윈도우 경과 후 다시 true

## Acceptance Criteria

```bash
npm run lint
npm test        # embedded-postgres 테스트 포함 green
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 모든 신규 테이블 정책이 `USING` + `WITH CHECK` 둘 다 `(select auth.uid())` 스코프인가?
   - `contract_signatures`에 update/delete 정책이 없는가?
   - anon에게 테이블 직접 권한이 없는가?
   - 0017이 enum ADD VALUE 단독 파일인가?
3. 결과에 따라 `phases/10-signature-v2/index.json`의 step 1을 업데이트한다 (성공: completed+summary / 3회 실패: error+error_message / 개입 필요: blocked+blocked_reason 후 중단).

## 금지사항

- RPC 함수(`send_signature_request_with_event` 등 5종)를 이 step에서 만들지 마라. 이유: step 2 소관 — anon DEFINER RPC는 한 파일에 모아 보안 리뷰 표면을 한곳에 둔다. 단 `consume_anon_rate_limit`은 예외로 이 step에 포함(테이블과 결합된 유틸).
- 원격 Supabase에 마이그레이션을 적용하지 마라. 이유: 원격 반영은 phase 완료 후 사용자가 MCP로 수동 수행.
- 기존 `rate_limit_events` 테이블을 수정하지 마라. 이유: user_id NOT NULL 구조는 authenticated 경로에서 계속 사용됨.
- contracts 기존 flat 서명 컬럼(signature_image_path 등)을 제거·이관하지 마라. 이유: owner 호환용 유지가 확정 결정(데이터 마이그레이션 불필요).
- 기존 테스트를 깨뜨리지 마라.

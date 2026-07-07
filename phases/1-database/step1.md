# Step 1: schema-migrations

## 읽어야 할 파일

먼저 아래 파일들을 읽고 데이터 모델과 무결성 규칙을 파악하라:

- `/docs/ARCHITECTURE.md` — "데이터 모델(Postgres, RLS 활성)"의 6테이블 컬럼 정의 **전체** + "데이터 모델 규칙"(공통 컬럼·CHECK 제약·FK `ON DELETE RESTRICT`·updated_at 트리거)
- `/docs/ADR.md` — ADR-002(마이그레이션은 Supabase CLI SQL), ADR-006(상태·이벤트 append-only), ADR-008(soft-delete·is_demo)
- `/AGENTS.md`, `/CLAUDE.md` — 상태 전이는 이벤트 append, 서버 소유 필드
- phase 1 step 0 산출물: `src/test/pg.ts`(`applyMigrations`·`runAs`·`createUser`·부트스트랩) — 이 마이그레이션을 적용·검증할 harness
- phase 0 산출물: `src/types/database.ts`(현재 빈 스텁 — 이 step에서는 건드리지 마라)

이전 step에서 만든 harness를 꼼꼼히 읽고, 마이그레이션을 어떻게 적용·검증하는지 이해한 뒤 작업하라.

## 작업

`supabase/migrations/` 디렉토리에 **번호 접두 SQL 마이그레이션**(예: `0001_schema.sql`)을 작성해 6개 테이블·enum·제약·트리거를 만든다. Supabase CLI SQL 규약(파일명 오름차순 적용)을 따른다.

### enum 타입
- `contract_status`: `draft | signed | active | done | canceled`
- `withholding_type`: `wt_3_3 | wt_8_8 | none`
- `payment_status`: `draft | unpaid | paid`
- (channel은 enum이 아니라 `text` + CHECK — "진화 집합"이라 enum으로 굳히지 않는다)

### 테이블 (컬럼은 ARCHITECTURE.md 데이터 모델과 **정확히 일치**)

공통 관례: `id uuid primary key default gen_random_uuid()`, `user_id uuid not null references auth.users(id)`, 타임스탬프는 `timestamptz not null default now()`.

- **clients**: `name`(not null), `channel`(text not null, **CHECK in (`linkedin`,`instagram`,`youtube`,`direct`,`kmong`,`referral`,`other`)**), `contact_email?`, `contact_phone?`, `memo?`, `is_demo`(bool not null default false), `deleted_at?`(timestamptz), `created_at`, `updated_at`
- **contracts**: `client_id` **references clients(id) on delete restrict**, `title`, `scope`(text), `amount`(bigint, **CHECK amount > 0**), `start_date`(date), `end_date`(date), `status`(contract_status not null default `draft`), `clauses`(jsonb not null default `'[]'`), `contract_pdf_url?`, `signature_image_path?`, `doc_hash?`, `signature_meta?`(jsonb), `is_demo`, `deleted_at?`, `created_at`, `updated_at`
- **invoices**: `contract_id` **references contracts(id) on delete restrict**, `client_id` **references clients(id) on delete restrict**, `amount`(bigint, **CHECK amount > 0**), `issue_date`(date), `due_date`(date, **CHECK due_date >= issue_date**), `withholding_type`(withholding_type not null), `withholding_amount`(bigint not null, **CHECK 0 <= withholding_amount <= amount**), `net_amount`(bigint not null, **CHECK net_amount >= 0**), `payment_status`(payment_status not null default `draft`), `paid_at?`, `payment_method?`, `is_demo`, `deleted_at?`, `created_at`, `updated_at`
- **contract_events**: `user_id`, `contract_id` references contracts(id), `actor`(text not null), `from_status?`, `to_status`(text not null), `event_type`(text not null), `meta`(jsonb not null default `'{}'`), `created_at`. **※ updated_at·deleted_at 없음 — append-only**
- **invoice_events**: contract_events와 동일 구조, `invoice_id` references invoices(id)
- **profiles**: `user_id uuid` **primary key** references auth.users(id), `display_name?`, `default_withholding_type`(withholding_type not null default `none`), `bank_name?`, `bank_account_number?`, `bank_account_holder?`, `created_at`, `updated_at`

### updated_at 트리거
- `set new.updated_at = now()`를 수행하는 `BEFORE UPDATE` 트리거 함수를 만들고, `updated_at`을 가진 테이블(**clients·contracts·invoices·profiles**)에만 부착. 이벤트 테이블(contract_events·invoice_events)엔 붙이지 마라.

### 제약 검증 테스트 (필수)
`supabase/*.sql`은 TDD 가드 예외지만, **제약이 실제로 걸리는지 통합 테스트로 증명**하라. step 0 harness로 마이그레이션 적용 후(`src/test/__tests__/schema.test.ts`):
- 정상 행 insert 성공(먼저 `createUser`로 유저·client를 만들고 FK를 채운다).
- `amount <= 0`, `withholding_amount > amount`, `withholding_amount < 0`, `net_amount < 0`, `due_date < issue_date` 각각 insert가 **에러로 거부**되는지.
- `contracts.status`에 enum 밖 값 → 거부.
- `clients.channel`에 집합 밖 값(예: `'tiktok'`) → 거부.
- 존재하지 않는 client_id로 contract insert → **FK 위반 거부**.

이 step의 테스트는 CHECK/enum/FK 검증이라 RLS와 무관하므로 소유자 역할로 실행해도 된다(role 전환 불필요).

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test    # 마이그레이션 적용 + CHECK/enum/FK 제약 통합테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 6테이블·3enum·channel CHECK·4개 수치 CHECK·FK `ON DELETE RESTRICT`·updated_at 트리거(이벤트 제외)가 ARCHITECTURE.md와 일치하는가?
   - 이벤트 테이블에 `updated_at`/`deleted_at`을 넣지 않았는가?
3. `phases/1-database/index.json`의 step 1을 업데이트(성공 `completed`+`summary` / 실패 `error` / 개입 필요 `blocked`).

## 금지사항

- RLS 정책·인덱스를 이 마이그레이션에 넣지 마라. 이유: 각각 step 2·3 소관. 섞으면 자기완결성·리뷰 단위가 깨진다.
- `src/types/database.ts`를 손으로 수정하지 마라. 이유: step 4에서 마이그레이션 introspection으로 자동 생성해 교체한다.
- 이벤트 테이블에 `updated_at`/`deleted_at`/UPDATE 트리거를 넣지 마라. 이유: append-only 설계(ADR-006) 위반.
- `deleted_at` 필터를 스키마/뷰에 박지 마라. 이유: soft-delete 필터는 step 5 쿼리 헬퍼에서만 적용한다(ADR-008). 스키마에 박으면 복원·감사·CSV에서 행이 사라진다.
- 기존 테스트를 깨뜨리지 마라.

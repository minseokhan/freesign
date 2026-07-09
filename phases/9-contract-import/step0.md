# Step 0: db-migration

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/CONTRACT_IMPORT_PLAN.md` — 이 phase 전체의 기획. 특히 "변경/생성 파일 §1"과 provenance 보존 취지.
- `/CLAUDE.md` — Storage는 private 버킷 + `{user_id}/...` 경로, DB엔 key만 저장. `service_role` 키는 요청 경로 금지.
- `supabase/migrations/0001_schema.sql` — `contracts` 테이블 정의(컬럼·기본값·제약)를 확인. 특히 `contract_pdf_url` 컬럼 정의를 그대로 참고한다.
- `supabase/migrations/0004_storage.sql` — 기존 `contract-artifacts` 버킷(private, 5MB, `application/pdf` 허용) 정책. **이 step에서 버킷/정책을 새로 만들지 않는다** — 기존 버킷을 재사용함을 확인만 한다.
- `src/types/database.ts` — `contracts` 테이블의 `Row`/`Insert`/`Update` 타입. `contract_pdf_url: string | null`이 어떻게 3곳(Row/Insert/Update)에 들어가 있는지 확인.

## 작업

### 1) 마이그레이션 신규 — `supabase/migrations/0008_source_pdf.sql`

- `contracts` 테이블에 `source_pdf_url text` 컬럼을 추가한다. nullable, 기본값 없음.
  ```sql
  alter table public.contracts
    add column if not exists source_pdf_url text;
  ```
- 컬럼 목적을 주석으로 남긴다: 발주처가 보낸 **원본** PDF의 Storage key. FreeSign이 **생성**한 서명본 PDF용 `contract_pdf_url`과 분리해 provenance를 보존한다.
- **버킷/RLS/스토리지 정책을 이 파일에 넣지 마라.** 기존 `contract-artifacts` 버킷과 정책을 그대로 재사용한다.

### 2) 생성 타입 반영 — `src/types/database.ts`

- `contracts` 테이블 타입의 `Row`에 `source_pdf_url: string | null`, `Insert`에 `source_pdf_url?: string | null`, `Update`에 `source_pdf_url?: string | null`을 추가한다.
- 기존 `contract_pdf_url` 항목 바로 옆(같은 3개 블록)에 동일한 형식으로 수기 추가한다. 다른 테이블 타입은 건드리지 마라.

## Acceptance Criteria

```bash
npm run lint
npx tsc --noEmit   # database.ts 타입이 유효한지
npm test           # 기존 테스트 green
```

- `npx tsc --noEmit`가 없거나 실패하면 `npm run build`로 대체 검증한다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 마이그레이션이 `add column if not exists`로 idempotent한가?
   - 버킷/정책을 새로 만들지 않고 기존 `contract-artifacts` 재사용을 전제로 하는가?
   - `database.ts`의 Row/Insert/Update **3곳 모두**에 `source_pdf_url`이 반영됐는가?
3. 결과에 따라 `phases/9-contract-import/index.json`의 step 0을 업데이트한다.

## 금지사항

- 신규 Storage 버킷이나 스토리지 RLS 정책을 만들지 마라. 이유: 기존 `contract-artifacts` 버킷을 재사용한다(계획 §1).
- `contract_pdf_url`을 삭제·변경하지 마라. 이유: 서명본 PDF용으로 이미 사용 중이며, 원본은 별도 컬럼으로 분리하는 것이 이 step의 목적.
- 마이그레이션을 실제 원격 DB에 apply하지 마라(SQL 파일 생성까지만). 이유: apply는 사용자/CLI 몫이며 이 step은 스키마 정의만 담당.
- 기존 테스트를 깨뜨리지 마라.

# Step 3: indexes

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "데이터 모델 규칙"의 인덱스 문단(부분 인덱스 목록)
- `/AGENTS.md`, `/CLAUDE.md`
- phase 1 step 0 산출물: `src/test/pg.ts`(`applyMigrations`)
- phase 1 step 1 산출물: `supabase/migrations/0001_*.sql`(테이블), step 2: `supabase/migrations/0002_*.sql`(RLS)

## 작업

인덱스 마이그레이션(예: `supabase/migrations/0003_indexes.sql`)을 추가한다. ARCHITECTURE 규칙의 부분 인덱스를 정확히 반영:

- **clients · contracts · invoices**: `(user_id) where deleted_at is null`
- **invoices**: `(user_id, due_date) where payment_status = 'unpaid'`
- **contracts · invoices**: `(user_id, client_id)`
- **contract_events**: `(contract_id, created_at)`
- **invoice_events**: `(invoice_id, created_at)`

### 검증 테스트
`src/test/__tests__/indexes.test.ts` — 마이그레이션 적용 후 `pg_indexes`(또는 `pg_index`/`pg_class`)를 조회해 위 인덱스가 **존재**하고, 부분 인덱스의 `WHERE` 조건(`deleted_at is null`, `payment_status = 'unpaid'`)이 정의에 포함되는지 assert.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test    # 인덱스 존재·부분조건 검증 통합테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트: 부분 인덱스의 `WHERE` 절이 정확한가(`deleted_at is null`, `payment_status = 'unpaid'`)? 이벤트 인덱스가 `(id, created_at)` 순서인가?
3. `phases/1-database/index.json`의 step 3을 업데이트(성공/실패/blocked).

## 금지사항

- 전체 인덱스(WHERE 없는)로 대체하지 마라. 이유: 부분 인덱스가 soft-delete 목록·미수(unpaid) 조회의 선택도를 높이는 게 설계 의도다.
- 스키마·RLS를 수정하지 마라. 이유: step 1·2 소관. 이 step은 인덱스만 추가한다.
- 기존 테스트를 깨뜨리지 마라.

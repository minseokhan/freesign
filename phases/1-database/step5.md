# Step 5: query-helpers

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "패턴"(읽기는 RSC 직접 조회, 내부 `/api` fetch 우회 금지), "데이터 흐름"(FK 소유권 재검증), "데이터 모델 규칙"(**`deleted_at IS NULL` 필터는 공용 쿼리 헬퍼에서**)
- `/docs/ADR.md` — ADR-008(soft-delete 필터는 RLS가 아니라 공용 쿼리 헬퍼)
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: `deleted_at IS NULL` 필터는 RLS가 아니라 공용 쿼리 헬퍼에서. **FK 참조**(invoice→contract/client)는 Server Action에서 **소유권 재조회 검증 후** insert(FK는 RLS 우회)
- phase 0 산출물: `src/lib/supabase/server.ts`(RLS 스코프 서버 클라이언트)
- phase 1 step 4 산출물: `src/types/database.ts`(생성 타입 — 헬퍼가 이 타입을 사용)

## 작업

`src/lib/db/` 공용 쿼리 헬퍼를 만든다. **`lib/` 로직이므로 TDD 대상 — 테스트를 먼저 작성**하라.

이 헬퍼들은 `@supabase/ssr` 쿼리 빌더 위의 얇은 래퍼다. **실제 행 수준 보안은 RLS(step 2)가 강제**하고, 여기서는 (a) soft-delete 필터의 일관 적용, (b) FK insert 전 소유권 재확인 경로를 제공한다.

시그니처(예시 — 내부 구현·정확한 형태는 재량):
- `notDeleted<Q>(query: Q): Q` — 쿼리 빌더에 `.is('deleted_at', null)`을 적용해 반환. 모든 도메인 목록/상세 읽기가 이 헬퍼를 거친다.
- `assertOwned(supabase, table, id): Promise<boolean>`(또는 `fetchOwned(...)`) — **RLS 스코프 서버 클라이언트**로 부모 행(예: contract_id·client_id)을 id로 재조회. 행이 있으면 소유(RLS가 이미 타인 행을 걸러냄). Server Action이 invoice insert 전에 contract/client 소유권을 재검증하는 데 쓴다.

**핵심 규칙(반드시 지켜라)**:
- `assertOwned`는 반드시 **요청 스코프(RLS) 서버 클라이언트**를 인자로 받아라. `service_role` 클라이언트를 받지 마라 — bypassrls라 소유권 검증이 무의미해진다.
- soft-delete 필터를 RLS·스키마로 옮기지 마라(ADR-008).

### 테스트
`@supabase/ssr` 클라이언트는 PostgREST 엔드포인트가 필요해 임베디드 PG로 직접 붙지 않는다. **가짜 쿼리 빌더(체이닝을 기록하는 목)** 로 단위 테스트하라(`src/lib/db/__tests__/*.test.ts`):
- `notDeleted`가 `.is('deleted_at', null)`을 정확히 1회 체이닝하는지.
- `assertOwned`가 대상 테이블을 id로 조회하고, 0행이면 `false`(또는 소유 아님)를 반환하는지.

행 수준 격리 자체는 step 2 RLS 통합테스트가 이미 검증했으므로 여기서 재검증하지 않는다(레이어 분리 — 헬퍼는 "쿼리 구성"의 정확성만, 보안은 RLS가 담당).

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test    # 쿼리 헬퍼 단위테스트(테스트 먼저) + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `deleted_at` 필터가 이 헬퍼(`lib/db`)에만 있고 RLS/스키마엔 없는가?
   - `assertOwned`가 RLS 스코프 클라이언트 전용인가(service_role 미수용)?
   - 테스트가 먼저 작성됐는가(TDD)?
3. `phases/1-database/index.json`의 step 5를 업데이트(성공/실패/blocked).

## 금지사항

- Server Action·라우트 핸들러·페이지를 만들지 마라. 이유: 읽기/쓰기 슬라이스는 phase 4~7 소관. 이 step은 재사용 헬퍼만 제공한다.
- `assertOwned`에 `service_role` 클라이언트를 쓰지 마라. 이유: bypassrls로 타인 소유 행도 통과 → FK 우회 삽입 취약점이 된다.
- `deleted_at` 필터를 RLS·스키마로 옮기지 마라. 이유: 복원·감사·CSV에서 soft-delete 행이 사라진다(ADR-008).
- 임베디드 PG로 supabase-js를 붙이려 하지 마라(PostgREST 부재). 이유: 시간 낭비이며, 보안 검증은 step 2가 이미 담당한다.
- 기존 테스트를 깨뜨리지 마라.

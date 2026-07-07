# Step 2: rls-policies

## 읽어야 할 파일

먼저 아래 파일들을 읽고 보안 경계(RLS) 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "데이터 모델 규칙"의 RLS 문단(**`USING` + `WITH CHECK` 둘 다**, `(select auth.uid())` 래핑, 이벤트 테이블 select/insert만 = append-only)
- `/docs/ADR.md` — ADR-002(RLS가 1차 접근제어), ADR-008(soft-delete)
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: `WITH CHECK (user_id = (select auth.uid()))` 누락 시 타 user 삽입·소유권 이관 가능 → **둘 다 필수**
- phase 1 step 0 산출물: `src/test/pg.ts`(`runAs`·`runAsAnon`·`createUser`·`grantSupabaseRoles` — RLS는 `authenticated` role로 검증)
- phase 1 step 1 산출물: `supabase/migrations/0001_*.sql`(테이블 정의)

이전 step의 harness와 스키마를 읽고, RLS를 어떤 role로 검증해야 하는지(소유자 아님, `authenticated`) 이해한 뒤 작업하라.

## 작업

RLS 마이그레이션(예: `supabase/migrations/0002_rls.sql`)을 추가한다.

### 전 테이블 RLS 활성
6개 테이블 모두 `alter table ... enable row level security;`.

### 도메인 테이블 정책 (clients · contracts · invoices)
각 테이블에 `to authenticated`로:
- **SELECT**: `using (user_id = (select auth.uid()))`
- **INSERT**: `with check (user_id = (select auth.uid()))`
- **UPDATE**: `using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))`
- **DELETE 정책은 만들지 마라** — 도메인 삭제는 soft-delete(UPDATE `deleted_at`)로만 한다. 물리 삭제는 `service_role`(bypassrls) CLI 전용.

`(select auth.uid())` 래핑은 필수다(플래너가 유저당 1회로 캐싱 → 행마다 재평가 방지).

### profiles 정책
`user_id`가 PK이자 소유자. SELECT/INSERT/UPDATE에 동일 패턴(`user_id = (select auth.uid())`).

### 이벤트 테이블 정책 (contract_events · invoice_events) — append-only
- **SELECT**: `using (user_id = (select auth.uid()))`
- **INSERT**: `with check (user_id = (select auth.uid()))`
- **UPDATE/DELETE 정책 없음** = append-only. 정책이 없으면 해당 동작은 기본 거부된다.

### RLS 경계 테스트 (TDD 필수 — 보안 경계)
`src/test/__tests__/rls.test.ts`. step 0 harness의 `runAs(pool, userId, ...)`(= `authenticated` role + jwt sub)로 실행한다. **소유자/수퍼유저로 실행하지 마라**(RLS 우회). 검증(최소):

- 유저 A가 자기 client insert → 유저 B의 `runAs`로 SELECT 시 **0행**(격리).
- 유저 B가 `user_id = A`로 client insert 시도 → **WITH CHECK 위반 에러**(타 user 삽입 차단).
- 유저 A가 자기 client의 `user_id`를 B로 UPDATE 시도 → **WITH CHECK 위반**(소유권 이관 차단).
- 유저 A가 이벤트 insert 후, 그 이벤트를 UPDATE/DELETE 시도 → **거부**(append-only).
- `runAsAnon`으로 임의 테이블 SELECT → **0행/거부**(익명 차단).
- 정상 경로: 유저 A가 `user_id = A`로 insert·본인 행 SELECT → **성공**.

(FK 때문에 각 유저는 `createUser`로 먼저 만들고, contracts/invoices 테스트는 소유한 client/contract를 선삽입한다.)

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test    # RLS 경계 테스트 + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 6테이블 모두 RLS enable?
   - 도메인·profiles에 SELECT/INSERT/UPDATE 정책 + **WITH CHECK**?
   - 이벤트 테이블은 select/insert만(UPDATE/DELETE 정책 부재)?
   - 테스트가 `authenticated` role로 도는가(소유자 아님)?
3. `phases/1-database/index.json`의 step 2를 업데이트(성공/실패/blocked).

## 금지사항

- `WITH CHECK`를 빼고 `USING`만 쓰지 마라. 이유: INSERT/UPDATE 시 타 user_id 주입·소유권 이관이 뚫린다(CRITICAL).
- 이벤트 테이블에 UPDATE/DELETE 정책을 만들지 마라. 이유: append-only(ADR-006) 위반, 기록 체인 변조 가능.
- 도메인 테이블에 DELETE 정책을 만들지 마라. 이유: 실데이터 물리 삭제 경로가 열린다. 삭제는 soft-delete UPDATE로만.
- RLS 테스트를 소유자/수퍼유저 연결로 실행하지 마라. 이유: RLS를 우회해 통과처럼 보이나 실제 검증이 아니다.
- 기존 테스트를 깨뜨리지 마라.

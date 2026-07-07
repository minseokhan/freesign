# Step 6: demo-seed

## 읽어야 할 파일

- `/SCENARIO.md` — 샘플 데이터 원본("김하나" 유저, 클라이언트 **"무디"(채널: 인스타그램)**, 계약 **"무디 브랜드 리뉴얼" 300만원/3주**, 그 아래 인보이스 등 ①~⑥ 흐름). 시드는 이 시나리오를 재현한다.
- `/docs/ARCHITECTURE.md` — 데이터 모델, "데이터 모델 규칙"의 하드삭제 문단(**`is_demo=true`만** 예외), 원천징수·금액은 발행 시점 스냅샷
- `/docs/ADR.md` — ADR-006(스냅샷), ADR-008(`is_demo` 플래그)
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: **`service_role`은 CLI 시드에서만**. 요청 경로(app/api·Server Action·브라우저)에서 절대 금지
- phase 1 step 0 산출물: `src/test/pg.ts`(임베디드 PG로 시드 검증·`createUser`), step 1: `supabase/migrations`(스키마), step 4: `src/types/database.ts`
- phase 0 산출물: `src/lib/env.ts`(`getServerEnv` — service_role 접근 패턴)

## 작업

데모 데이터 시드를 만든다. SCENARIO의 샘플을 **`is_demo = true`** 로 삽입한다. **CLI 전용**이며 요청 경로에 유입되면 안 된다.

구조:
- 시드 **로직**: `src/lib/db/seed.ts` — `seedDemo(exec, userId)` 형태. `exec`는 SQL 실행자(테스트에선 임베디드 PG의 `pg` 클라이언트, 실제 사용 시엔 CLI 엔트리가 주입). **`lib/` 로직이므로 TDD 대상 — 테스트 먼저.**
  - 모든 삽입 행은 `is_demo = true`, `user_id = userId`.
  - 삽입 순서: client → contract(client_id FK) → invoice(contract_id·client_id FK). FK 순서를 지켜라.
  - 인보이스의 `withholding_amount`·`net_amount`는 **발행 시점 스냅샷 상수로 고정 삽입**한다. 계산 로직(`lib/tax.ts`)은 phase 2 소관이므로 여기서 구현하지 말고, CHECK 제약(`0 <= withholding_amount <= amount`, `net_amount = amount - withholding_amount >= 0`)을 만족하는 상수를 넣어라.
- CLI **엔트리**: `scripts/seed.mjs`(`.mjs` — TDD 가드 예외) + `package.json`에 `"db:seed"` 스크립트. `getServerEnv()`의 service_role로 Supabase에 연결하거나 DB 접속 문자열로 직접 연결한다. **이 엔트리를 app/api·Server Action·클라이언트 코드에서 import하지 마라.**

### 테스트
`src/lib/db/__tests__/seed.test.ts` — step 0 harness로 임베디드 PG 기동·마이그레이션 적용 후:
- `createUser`로 테스트 유저 생성 → `seedDemo(pgClient, testUserId)` 실행.
- 클라이언트/계약/인보이스가 `is_demo = true`로 삽입됐는지, FK가 올바르게 연결됐는지, 스냅샷 수치가 CHECK 제약을 통과하는지 assert.
- 시드는 RLS 우회가 정상(service_role 상당)이므로 소유자 role로 삽입해도 된다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test    # 시드 통합테스트(테스트 먼저) green
```

(`npm run db:seed`는 실제 Supabase 프로젝트/키가 있어야 하므로 AC에 넣지 않는다. 시드 **로직**은 임베디드 PG 통합테스트로 검증된다.)

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 모든 시드 행이 `is_demo = true`인가?
   - seed 로직이 요청 경로(app/api·Server Action·페이지)에서 import되지 않는가(scripts/·lib 전용)?
   - 스냅샷 수치가 CHECK 제약을 통과하는가?
   - 테스트가 먼저 작성됐는가(TDD)?
3. `phases/1-database/index.json`의 step 6을 업데이트(성공/실패/blocked).

## 금지사항

- 시드를 app/api·Server Action·페이지에서 호출/import하지 마라. 이유: `service_role`/CLI 전용 경로다. 요청 경로 유입은 CLAUDE.md CRITICAL 위반이다.
- 실데이터(`is_demo = false`)를 삽입하거나 기존 행을 하드삭제하지 마라. 이유: 이 step은 "데모 채우기"만이다. "데모 지우기"·실삭제는 phase 7 소관.
- 원천징수 계산 로직을 여기서 구현하지 마라. 이유: `lib/tax.ts`(phase 2) 소관. 여기선 CHECK를 만족하는 스냅샷 상수만 삽입한다.
- 기존 테스트를 깨뜨리지 마라.

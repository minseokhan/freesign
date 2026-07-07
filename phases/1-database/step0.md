# Step 0: pg-test-harness

## 읽어야 할 파일

먼저 아래 파일들을 읽고 데이터 레이어의 검증 전략을 파악하라:

- `/docs/ARCHITECTURE.md` — "데이터 모델(Postgres, RLS 활성)"·"데이터 모델 규칙"(RLS는 `user_id = (select auth.uid())`, 이벤트 테이블 append-only). 이 harness가 그 RLS를 **실제로 검증할 토대**다.
- `/docs/ADR.md` — ADR-002(Supabase 순수 클라이언트, **RLS가 1차 접근제어**), ADR-007(Vitest + TDD, 보안 경계는 자동 검증 필수)
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: RLS `USING` + `WITH CHECK (user_id = (select auth.uid()))` 둘 다, 서버 인가는 `getUser()`
- phase 0 산출물: `vitest.config.ts`, `vitest.setup.ts`, `package.json`(스크립트·의존성), `src/lib/env.ts`(테스트에서 목 env를 쓰는 패턴)

**배경**: 이 phase는 **로컬 임베디드 Postgres(docker 불필요)** 로 마이그레이션·RLS·시드를 자율 검증한다. 이 step은 그 검증 토대(테스트용 실 Postgres harness)만 만든다. 스키마·정책·인덱스는 다음 step 소관이며, 이 step에서는 만들지 않는다.

## 작업

`embedded-postgres`(docker 없이 실제 Postgres 바이너리를 로컬 기동)와 `pg`(node-postgres)를 **devDependency**로 추가하고, Vitest 통합 테스트용 DB harness를 만든다.

harness 파일은 반드시 `src/test/` 아래에 둔다(예: `src/test/pg.ts`). 이유: `.codex` TDD 가드는 경로에 `test`가 포함되면 테스트 동반을 요구하지 않는다 — harness는 앱 로직이 아니라 테스트 인프라다.

harness 책임(시그니처 수준, 내부 구현은 재량):

1. **DB 기동/종료** — 임시 디렉토리에 비영속(`persistent: false`) Postgres를 기동하고 연결 URL/`pg` 풀을 제공. 종료 시 정리.
   - 성능: 테스트마다 새 인스턴스를 띄우지 마라. Vitest `globalSetup`에서 **인스턴스 1개**만 띄우고 연결 URL을 공유하라(`provide`/전역/env 중 택1). 이유: Stop 훅이 매 턴 `npm test`를 돌리므로 반복 부팅은 타임아웃을 유발한다.
2. **Supabase 호환 부트스트랩** — 마이그레이션 적용 **전에** 실행할 SQL. 실제 Supabase가 이미 제공하는 것을 로컬에 재현:
   - `create schema if not exists auth;`
   - `auth.users` 최소 스텁 테이블: `id uuid primary key default gen_random_uuid(), email text`
   - `auth.uid()` 함수 — **정확히 아래 시맨틱으로** (RLS 정책이 이 함수에 의존한다):
     ```sql
     create or replace function auth.uid() returns uuid language sql stable as $$
       select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
     $$;
     ```
   - 역할: `anon`(nologin), `authenticated`(nologin), `service_role`(nologin **bypassrls**). 이미 있으면 건너뛴다.
3. **마이그레이션 적용** — `applyMigrations(pool, dir = 'supabase/migrations')`: 디렉토리의 `*.sql`을 **파일명 오름차순**으로 읽어 순차 실행. 디렉토리가 없거나 비면 no-op(이 step 시점엔 마이그레이션이 없다).
4. **권한 부여** — 마이그레이션 적용 후 `authenticated`/`anon`에 `public` 스키마 USAGE + 테이블 SELECT/INSERT/UPDATE/DELETE를 GRANT하는 헬퍼(`grantSupabaseRoles(pool)`). 이유: RLS(행 수준)와 별개로 역할에 **테이블 권한**이 없으면 쿼리 자체가 거부된다. 이게 없으면 다음 step의 RLS 테스트가 `authenticated`로 아무 쿼리도 못 한다.
5. **테스트 유저 생성** — `createUser(pool, email?): Promise<uuid>`: `auth.users`에 행을 삽입하고 새 uuid를 반환. 이유: 도메인 행의 `user_id`는 `auth.users(id)`를 FK 참조하므로, 다음 step 테스트가 유저를 먼저 만들어야 삽입이 가능하다.
6. **요청 컨텍스트 에뮬레이션** — 특정 유저로 쿼리를 실행하는 헬퍼:
   - `runAs(pool, userId, sql, params?)` — 한 트랜잭션 안에서 `set local role authenticated;` 후 `select set_config('request.jwt.claims', json_build_object('sub', userId)::text, true);` 를 걸고 쿼리 실행.
   - `runAsAnon(pool, sql, params?)` — `set local role anon`.
   - **핵심 규칙**: 마이그레이션은 소유자(`postgres`)로 적용된다. **테이블 소유자·수퍼유저는 RLS를 우회**한다. 따라서 RLS 검증 쿼리는 반드시 `authenticated`/`anon` **역할로 전환한 상태**에서 실행돼야 한다. 이 규칙을 harness 주석에 명시하라 — 다음 step의 RLS 테스트가 이를 어기면 정책 검증이 무력화된다.
   - 격리: 각 테스트를 트랜잭션으로 감싸 롤백하는 헬퍼(`withRollback`) 또는 테스트 간 truncate를 제공해 상태 오염을 막아라.
7. **스모크 테스트** — `src/test/__tests__/pg.test.ts`(또는 유사):
   - DB 부팅 → 부트스트랩 → `createUser`로 유저 생성 → `runAs(pool, userId, 'select auth.uid()')`가 그 uuid를 반환하는지 검증(= 요청 컨텍스트 에뮬레이션이 실제로 동작).
   - 빈 `applyMigrations`가 no-op으로 통과하는지 검증.

## Acceptance Criteria

```bash
npm install       # embedded-postgres 바이너리 다운로드 포함
npm run lint
npm run build
npm test          # pg harness 스모크 통합테스트 green + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - harness가 `src/test/` 아래에 있어 앱 번들(`src/lib`·`src/app`)에 섞이지 않는가?
   - `embedded-postgres`·`pg`가 **devDependencies**인가(런타임 dependency 아님)?
   - `auth.uid()`가 `request.jwt.claims->>'sub'`를 읽는가? `runAs`가 `authenticated` role로 전환하는가?
   - Vitest globalSetup으로 인스턴스를 **1회만** 띄우는가?
3. 결과에 따라 `phases/1-database/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 harness 파일 경로·공개 헬퍼 이름(applyMigrations·runAs·createUser 등) 요약
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - `embedded-postgres` 바이너리를 받을 수 없는 등 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단(단, 그 전에 재시도)

## 금지사항

- 스키마(테이블·enum·정책·인덱스)를 만들지 마라. 이유: step 1~3 소관. 이 step은 "빈 DB를 띄우고 role/claims를 흉내내는 토대"까지만이다.
- 테스트마다 Postgres 인스턴스를 새로 부팅하지 마라. 이유: Stop 훅의 `npm test`가 매 턴 돌아 반복 부팅이 600s 타임아웃을 유발한다.
- `embedded-postgres`·`pg`를 `dependencies`에 넣지 마라. 이유: 앱 런타임(Vercel)엔 불필요하고 번들만 키운다. 테스트 전용이다.
- RLS 검증용 헬퍼를 소유자/수퍼유저 연결로 실행하게 만들지 마라. 이유: 소유자는 RLS를 우회해 다음 step의 정책 검증이 무력화된다. 반드시 `authenticated`/`anon` role로 전환하라.
- 기존 테스트를 깨뜨리지 마라.

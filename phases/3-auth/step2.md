# Step 2: dev-test-login

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-007**(OAuth E2E는 **dev 전용 테스트 로그인 경로로 대체**. dev 테스트 로그인은 **백도어 리스크 → 이중 가드**(빌드 타임 제외 + `NODE_ENV!=='production'`) + 프로덕션 빌드 시 404 검증으로 방어)
- `/docs/ARCHITECTURE.md` — 서버 인가는 `getUser()`, `@supabase/ssr` 쿠키 세션
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: `service_role` 키는 요청 경로에서 절대 금지(CLI 시드 전용). middleware는 토큰 갱신 전용.
- phase 0 산출물: `src/lib/supabase/server.ts`(쿠키 세션을 세팅하는 서버 클라이언트), `src/lib/env.ts`(env 스키마 — **이 step은 여기에 필수 항목을 추가하지 마라**, 아래 참조)
- phase 3 step 0~1 산출물: `src/app/(auth)/login/page.tsx`, `src/app/auth/callback/route.ts`, `src/lib/auth.ts`(`requireUser`), 가드가 붙은 `src/app/(dashboard)/layout.tsx`

**배경**: 실 Google OAuth는 자동 E2E(Playwright, phase 8)에서 돌릴 수 없다(외부 IdP 왕복). 그래서 **dev 전용 테스트 로그인 경로**로 세션을 만들어 E2E가 보호 라우트에 진입하게 한다. 이 경로는 프로덕션에 노출되면 **인증 우회 백도어**가 되므로 **이중 가드**가 이 step의 핵심이다. 이 step은 그 **가드된 라우트 + 이중 가드 테스트**까지다 — Playwright 설정·실 테스트 유저 시딩·해피패스 플로우는 **phase 8** 소관이다.

## 작업

dev 전용 테스트 로그인 라우트 핸들러 `src/app/dev/test-login/route.ts`를 만든다. `route.ts`는 `.codex` TDD 가드 대상 — **테스트를 먼저 작성**하라(`src/app/dev/test-login/__tests__/route.test.ts` 또는 co-located).

### 이중 가드 (핵심 — 반드시 둘 다)

핸들러(GET 또는 POST) 진입 즉시, **두 조건을 모두** 통과할 때만 로그인 로직을 수행한다. 하나라도 실패하면 **404**(`notFound()` 또는 `new NextResponse(null, { status: 404 })`)로 응답하고 로그인 로직에 진입조차 하지 마라:

1. **`process.env.NODE_ENV !== "production"`** — 프로덕션 런타임에서 무조건 404.
2. **명시적 opt-in env 플래그**(예: `ALLOW_TEST_LOGIN === "true"`) — dev/test 빌드에서도 이 플래그가 없으면 404. 이유: 비프로덕션 환경(스테이징 등)에 실수로 노출되는 것까지 막는 **독립된 2차 가드**.

두 가드는 **독립적**이어야 한다(하나가 뚫려도 다른 하나가 막게). 로그인 성공 경로는 두 가드를 모두 통과한 뒤에만 존재해야 한다.

### 로그인 로직 (가드 통과 후)

- **`service_role`을 절대 쓰지 마라**(CRITICAL — 요청 경로 금지). 대신 `src/lib/supabase/server.ts`의 서버 클라이언트로 `supabase.auth.signInWithPassword({ email, password })`를 호출해 쿠키 세션을 세팅한다.
- 테스트 계정 자격증명은 **`process.env`에서 직접** 읽어라(예: `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`). 하드코딩 금지.
  - **`src/lib/env.ts`의 필수 스키마에 추가하지 마라.** 이유: 이들은 dev/E2E 전용 선택 변수다. 필수 스키마에 넣으면 프로덕션 빌드·기존 env 테스트가 값 부재로 깨진다. 라우트 안에서 `process.env`를 직접 읽고, 없으면 500이 아니라 명확한 4xx로 처리하라.
- 성공 → `/dashboard`로 리다이렉트. 실패 → 4xx(throw로 500 내지 마라).

주의: 실제 테스트 유저를 Supabase Auth에 시딩하는 것과 Playwright가 이 경로를 호출하는 배선은 **phase 8** 소관이다. 이 step은 라우트·가드·테스트만 만든다. 시딩이 안 됐다고 `blocked` 처리하지 마라.

### 테스트 (먼저 작성 — supabase·env 목)

`process.env.NODE_ENV`·플래그·Supabase 클라이언트를 목/스텁하여:
- **`NODE_ENV="production"`** → 404, **`signInWithPassword`를 호출하지 않음**(가드가 로그인 경로를 완전히 차단).
- **비프로덕션 + opt-in 플래그 없음** → 404, 로그인 미시도.
- **비프로덕션 + 플래그 있음 + 자격증명 있음** → `signInWithPassword` 호출 후 `/dashboard`로 리다이렉트.
- (선택) 자격증명 env 부재 → 명확한 4xx(500 아님).

## Acceptance Criteria

```bash
npm run lint
npm run build     # dev 테스트 로그인 라우트가 컴파일 (프로덕션 빌드에서도 파일은 존재하되 런타임 404)
npm test          # 이중 가드 테스트(테스트 먼저: production→404, 로그인 미시도) + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - **이중 가드**가 둘 다 존재하고 독립적인가? `NODE_ENV="production"`에서 404이며 `signInWithPassword`에 도달하지 않는가(테스트로 증명)?
   - `service_role`을 쓰지 않는가(요청 경로 금지)? `signInWithPassword` + 서버 클라이언트로 쿠키 세션을 세팅하는가?
   - 테스트 자격증명을 `process.env`에서 읽고 **필수 env 스키마에 넣지 않았는가**(프로덕션 빌드·기존 env 테스트 무손상)?
   - 가드 테스트가 먼저 작성됐는가(TDD)?
3. `phases/3-auth/index.json`의 step 2를 업데이트(성공 `completed`+summary / 3회 실패 `error` / 개입 필요 `blocked`). 이 step 완료 시 **phase 3 전체 완료**.

## 금지사항

- `NODE_ENV` 체크 **하나만** 두지 마라. 이유: 로드맵·ADR-007이 **이중 가드**를 요구한다. 단일 가드는 스테이징/오설정 시 인증 우회 백도어가 된다.
- 가드보다 로그인 로직을 먼저 실행하지 마라. 이유: 가드는 로그인 경로에 **도달하기 전에** 차단해야 한다(부분 실행 방지).
- `service_role` 키를 이 라우트에서 쓰지 마라. 이유: CRITICAL — service_role은 CLI 시드 전용, 요청 경로 절대 금지. bypassrls로 인증 모델이 무의미해진다.
- `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`를 `src/lib/env.ts` 필수 스키마에 추가하지 마라. 이유: dev 전용 선택 변수 — 필수화하면 프로덕션 빌드·기존 env 테스트가 깨진다.
- Playwright 설정·테스트 유저 시딩·E2E 해피패스를 만들지 마라. 이유: phase 8 소관.
- `middleware.ts`·(auth)·(dashboard) 가드를 수정하지 마라. 이유: step 0~1 확정본. 이 step은 dev 로그인 경로만 추가한다.
- 기존 테스트를 깨뜨리지 마라.

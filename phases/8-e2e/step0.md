# Step 0: playwright-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 테스트 관례를 파악하라:

- `/docs/ADR.md` — **ADR-007**(테스트 전략). E2E는 실사용 플로우 자동 검증. OAuth 실플로우는 **dev 테스트 로그인 경로로 대체**.
- `/docs/UX_PRINCIPLES.md` — 상태·피드백 원칙(E2E가 검증할 사용자 여정의 기준).
- `/CLAUDE.md` — 기술 스택(`Vitest + Playwright`), 개발 프로세스(TDD), 명령어(`npx playwright test`).
- 이전 phase 산출물(실제 경로 — 그대로 재사용/참조):
  - `vitest.config.ts` — **현재 `globalSetup: ["./src/test/pg-global-setup.ts"]`(임베디드 pg) + jsdom.** Vitest 기본 include는 `**/*.{test,spec}.*`라 **`.spec.ts`도 수집한다.** Playwright 스펙을 `.spec.ts`로 두면 vitest가 잡아 `@playwright/test`의 `test`와 충돌한다 → **반드시 vitest에서 e2e 디렉토리를 제외**하라(아래 작업 3).
  - `src/app/dev/test-login/route.ts` — **dev 전용 테스트 로그인**(GET). `NODE_ENV!=='production'` **그리고** `ALLOW_TEST_LOGIN==='true'`일 때만 동작, `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`로 `signInWithPassword` 후 `/dashboard`로 리다이렉트. **이 라우트는 수정하지 말고 E2E 인증 진입점으로 재사용**한다. 이중 가드(프로덕션 404)는 유지.
  - `src/app/dev/test-login/__tests__/route.test.ts` — 위 라우트의 기존 테스트(깨뜨리지 마라).
  - `src/app/(auth)/login/page.tsx` — 로그인 페이지(공개, 인증/DB 쓰기 없음). **step 0의 스모크 스펙 대상**(라이브 Supabase 없이 렌더되는 유일한 안전 대상).
  - `package.json` — scripts(`dev`·`build`·`lint`·`test`)·deps. `test:e2e` 스크립트를 추가한다.
  - `next.config.ts` — 빌드 설정(참고).

**배경**: 이 step은 **Playwright 실행 인프라만** 놓는다 — 의존성, 설정, vitest와의 분리, dev 테스트 로그인 기반 인증 진입점, 그리고 **라이브 Supabase 없이도 통과하는 공개 페이지 스모크 스펙 1개**. 실제 해피패스 플로우(로그인~CSV)는 **step 1 소관**이다. 여기서 플로우 스펙을 쓰지 마라.

## 작업

### 1) 의존성 · 스크립트

- `@playwright/test`를 devDependency로 추가(`npm install -D @playwright/test`). **브라우저 바이너리 다운로드(`npx playwright install`)가 네트워크 문제로 실패하면** step을 실패시키지 말고 아래 AC(`--list`)로 검증하라(브라우저 없이 스펙 컴파일·발견만 확인).
- `package.json` scripts에 추가: `"test:e2e": "playwright test"`.

### 2) `playwright.config.ts`(루트 신규)

- `testDir: "./e2e"`, `fullyParallel: true`, `forbidOnly: !!process.env.CI`, `retries: process.env.CI ? 2 : 0`.
- `use.baseURL`: `process.env.E2E_BASE_URL ?? "http://localhost:3000"`.
- `projects`: chromium 1개(`{ name: "chromium", use: devices["Desktop Chrome"] }`).
- `webServer`: 로컬에서 앱을 띄운다. `command`는 **프로덕션 유사 구동**(`npm run build && npm run start` — `start` 스크립트가 없으면 `next start`로 추가) 또는 개발 구동(`npm run dev`) 중 택1(재량). `url: baseURL`, `reuseExistingServer: !process.env.CI`, 넉넉한 `timeout`. **환경변수 `ALLOW_TEST_LOGIN=true`가 webServer 프로세스에 전달되도록** `env`에 명시(dev 테스트 로그인 활성화).

### 3) vitest에서 e2e 제외 — **CRITICAL**

- `vitest.config.ts`의 `test`에 `exclude`를 추가해 **`e2e/**`를 vitest 수집 대상에서 제외**한다. Vitest 기본 exclude(`node_modules`·`dist` 등)를 덮어쓰지 않도록 기본값을 유지하며 `e2e/**`를 추가하라(예: `exclude: [...configDefaults.exclude, "e2e/**"]`, `configDefaults`는 `vitest/config`에서 import).
- **이유: Vitest 기본 include가 `.spec.ts`를 잡아 Playwright 스펙을 실행하려다 `test`/`expect` 충돌로 깨진다.** 이 분리 없이는 `npm test`가 실패한다.

### 4) 인증 진입점(E2E 로그인 헬퍼)

- E2E가 인증 상태로 시작하도록 **dev 테스트 로그인(`/dev/test-login`)을 사용하는 헬퍼/셋업**을 놓는다(재량 형태): 예) `e2e/global-setup.ts`에서 요청 컨텍스트로 `/dev/test-login`을 호출해 `storageState`를 저장하고 `use.storageState`로 주입, 또는 로그인 픽스처.
- **주의: 이 헬퍼의 실제 실행은 라이브 Supabase + 시드된 `E2E_TEST_EMAIL` 유저 + `ALLOW_TEST_LOGIN=true`가 있어야 성공한다.** step 0에서는 헬퍼 **코드만** 놓고, 실제 인증 실행 검증은 step 1에서 한다. **자격증명/URL을 코드에 하드코딩하지 마라**(전부 env).

### 5) 공개 페이지 스모크 스펙 — `e2e/smoke.spec.ts`(신규)

- **라이브 Supabase/인증이 필요 없는 공개 페이지만** 검증한다: `/login`으로 이동해 로그인 페이지 핵심 요소(예: Google 로그인 버튼/제목)가 보이는지 `expect`. **DB 쓰기·인증이 필요한 페이지를 스모크로 두지 마라**(step 1 소관).

### 6) `.gitignore`

- `playwright-report/`, `test-results/`, e2e 인증 상태 파일(예: `e2e/.auth/`)을 추가한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test                    # vitest green — e2e 스펙이 vitest에서 제외되어야 함(작업 3)
npx playwright test --list  # e2e 스펙이 TypeScript 컴파일·발견됨(브라우저/서버 불필요)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - **vitest가 `e2e/**`를 제외**하는가? `npm test`가 여전히 green(기존 170 테스트)인가?
   - `npx playwright test --list`가 스펙을 **에러 없이 나열**하는가(config 로드·TS 컴파일 OK)?
   - dev 테스트 로그인 라우트를 **수정하지 않고 재사용**했는가? 자격증명이 전부 env인가(하드코딩 없음)?
   - 스모크 스펙이 **공개 페이지(`/login`)**만 대상으로 하는가(인증/DB 쓰기 없음)?
   - `webServer.env`에 `ALLOW_TEST_LOGIN=true`가 있는가?
3. `phases/8-e2e/index.json`의 step 0을 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`.
   - 3회 시도 후 실패 → `"status": "error"`, `"error_message"`.
   - `@playwright/test` 설치 자체가 네트워크로 불가하면 → `"status": "blocked"`, `"blocked_reason": "npm으로 @playwright/test 설치 불가(네트워크)"`.

## 금지사항

- 해피패스 플로우 스펙(로그인~계약~서명~인보이스~CSV)을 만들지 마라. 이유: step 1 소관.
- `.github/workflows` CI를 만들지 마라. 이유: step 2 소관.
- `loading.tsx`/`error.tsx`/빈 상태를 손대지 마라. 이유: step 3 소관.
- e2e 스펙을 vitest include로 흘려보내지 마라. 이유: `.spec.ts`가 vitest에 잡혀 `npm test`가 깨진다(작업 3 필수).
- dev 테스트 로그인 라우트의 이중 가드(프로덕션 404·`ALLOW_TEST_LOGIN`)를 약화시키지 마라. 이유: 백도어 리스크.
- E2E 자격증명/Supabase URL을 코드에 하드코딩하지 마라. 이유: 시크릿 노출.
- 기존 테스트를 깨뜨리지 마라.

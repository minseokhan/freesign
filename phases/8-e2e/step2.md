# Step 2: ci

## 읽어야 할 파일

먼저 아래 파일들을 읽고 빌드·테스트 파이프라인의 실제 커맨드와 의존을 파악하라:

- `/docs/ADR.md` — **ADR-007**(테스트 전략·CI). OAuth E2E는 dev 테스트 로그인으로 대체.
- `/CLAUDE.md` — 명령어(`npm run dev`·`build`·`lint`·`test`·`npx playwright test`). 시크릿은 서버 전용·요청 경로 밖.
- 이전 phase/step 산출물(실제 경로 — 파이프라인이 그대로 호출):
  - `package.json` — scripts(`lint`·`build`·`test`·`test:e2e`). `test`는 `vitest run`.
  - `vitest.config.ts` — **`globalSetup: ["./src/test/pg-global-setup.ts"]`.** 단위/통합 테스트가 **임베디드 Postgres**를 띄운다(별도 DB 서비스 불필요 — CI에서도 Node만 있으면 됨). 이 방식을 깨지 마라.
  - `src/test/pg-global-setup.ts`·`src/test/pg.ts` — 임베디드 pg 부트스트랩(참고).
  - `playwright.config.ts`(step 0) — `webServer`·`E2E_BASE_URL`·`ALLOW_TEST_LOGIN`.
  - `e2e/*.spec.ts`(step 0·1) — CI e2e 잡이 실행할 대상.
  - `src/app/dev/test-login/route.ts` — CI e2e 인증 진입점(`ALLOW_TEST_LOGIN`·`E2E_TEST_EMAIL`/`PASSWORD`).
  - `.env.example` — CI가 주입할 환경변수 키 목록(`NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`ANTHROPIC_API_KEY`·`NEXT_PUBLIC_SITE_URL`).

**배경**: 이 step은 **GitHub Actions CI 워크플로우**다. push/PR마다 lint·build·unit test를 돌리고, e2e는 별도 잡으로(시크릿이 있을 때) 돌린다. **CI 파일 작성이 목적**이며, 실제 CI 실행은 GitHub에서만 검증되므로 로컬 AC는 "기존 파이프라인이 여전히 green"임을 확인한다.

## 작업

### 1) `.github/workflows/ci.yml`(신규)

- 트리거: `push`(main) + `pull_request`.
- **`lint-build-test` 잡**(항상 실행, 시크릿 불필요):
  - `actions/checkout` → `actions/setup-node`(레포의 Node 버전, npm 캐시) → `npm ci` → `npm run lint` → `npm run build` → `npm test`.
  - **`npm test`는 임베디드 pg를 자체 부팅**하므로 별도 `services: postgres`를 붙이지 마라(불필요·혼란). 빌드에 필요한 최소 env는 더미/`.env.example` 수준으로 주입하되 시크릿은 넣지 마라.
- **`e2e` 잡**(시크릿 게이트):
  - `if`로 **Supabase E2E 시크릿이 있을 때만** 실행(예: `if: ${{ secrets.E2E_TEST_EMAIL != '' }}` 또는 environment gate). 시크릿이 없으면 스킵(실패가 아니라 skip).
  - `npm ci` → `npx playwright install --with-deps chromium` → `npm run test:e2e`.
  - env: `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`E2E_TEST_EMAIL`·`E2E_TEST_PASSWORD`·`ALLOW_TEST_LOGIN=true`·`E2E_BASE_URL`을 **`secrets`에서** 주입. `SUPABASE_SERVICE_ROLE_KEY`는 **요청 경로에서 쓰지 않으므로 앱 런타임 env로 넣지 마라**(필요 시 시드 잡에서만).
  - 실패 시 `playwright-report`를 `actions/upload-artifact`로 업로드(재량).
- **YAML은 유효해야 한다**(들여쓰기·따옴표). 잡 이름·스텝 이름을 명확히.

### 2) (선택) 배지/문서

- README에 CI 배지를 추가할 수 있으나 **필수는 아니다**(스코프 크립 금지). 하려면 한 줄만.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test          # 기존 green — CI 파일은 이 커맨드들에 영향 없음
# YAML 유효성(도구가 있으면):
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')" 2>/dev/null || echo "yaml 파서 미설치 — 육안 검증"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(로컬 파이프라인이 여전히 green).
2. 체크리스트:
   - `lint-build-test` 잡이 `npm ci → lint → build → test` 순인가?
   - **unit test 잡에 불필요한 `services: postgres`를 붙이지 않았는가**(임베디드 pg 사용)?
   - e2e 잡이 **시크릿 게이트**(없으면 skip)인가? `ALLOW_TEST_LOGIN=true`·E2E 자격증명을 **`secrets`에서** 주입하는가?
   - `SUPABASE_SERVICE_ROLE_KEY`를 앱 런타임 env로 흘리지 않았는가?
   - YAML이 파싱되는가(도구 있으면)/들여쓰기가 올바른가?
3. `phases/8-e2e/index.json`의 step 2 업데이트: 성공 → `completed`+`summary`; 3회 실패 → `error`+`error_message`.

## 금지사항

- unit test 잡에 `services: postgres`나 외부 DB를 붙이지 마라. 이유: vitest가 임베디드 pg를 자체 부팅(중복·오작동).
- e2e 잡을 무조건 실행되게 하지 마라. 이유: 시크릿 없으면 실패로 CI가 항상 red — 게이트(skip)로 둬라.
- `SUPABASE_SERVICE_ROLE_KEY`를 앱 런타임/e2e 런타임 env로 주입하지 마라. 이유: CRITICAL — service_role은 요청 경로 금지(시드 전용).
- E2E 스펙·상태 파일을 새로 만들지 마라. 이유: step 1·3 소관(이 step은 CI 배선만).
- 기존 테스트를 깨뜨리지 마라.

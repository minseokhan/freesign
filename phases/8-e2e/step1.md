# Step 1: e2e-flows

## 읽어야 할 파일

먼저 아래 파일들을 읽고 사용자 여정과 각 화면의 실제 셀렉터/문구를 파악하라:

- `/docs/ADR.md` — **ADR-007**. E2E는 해피패스 실사용 플로우. OAuth 실플로우는 **dev 테스트 로그인으로 대체**.
- `/docs/UX_PRINCIPLES.md`, `/docs/UI_GUIDE.md` — 각 화면의 문구·상태·배지(셀렉터 근거). `SCENARIO.md`(있으면) — 검증할 여정(무디 계약~정산).
- `/CLAUDE.md` — 읽기 RSC / 쓰기 Server Action. E2E는 이 실제 흐름을 브라우저로 통과시킨다.
- **step 0 산출물(그대로 재사용)**:
  - `playwright.config.ts` — testDir `./e2e`, `webServer`, `use.storageState`/인증 헬퍼, `E2E_BASE_URL`.
  - `e2e/global-setup.ts`(또는 인증 픽스처) — **dev 테스트 로그인(`/dev/test-login`) 기반 인증 진입점.** 플로우 스펙은 이 인증 상태에서 시작한다.
  - `e2e/smoke.spec.ts` — 공개 페이지 스모크(패턴 참고).
  - `package.json` `test:e2e` 스크립트.
- 검증할 화면의 실제 경로·컴포넌트(셀렉터 출처):
  - `src/app/(auth)/login/page.tsx`, `src/app/(dashboard)/dashboard/page.tsx`.
  - 클라이언트: `src/app/(dashboard)/clients/page.tsx`·`new/page.tsx`·`[id]/page.tsx`, `src/components/client-form.tsx`.
  - 계약: `src/app/(dashboard)/contracts/page.tsx`·`new/page.tsx`·`[id]/page.tsx`, `src/components/contract-form.tsx`·`contract-clauses-form.tsx`·`signature-pad.tsx`.
  - 인보이스: `src/app/(dashboard)/invoices/page.tsx`·`new/page.tsx`·`[id]/page.tsx`, `src/components/invoice-form.tsx`·`invoice-payment-toggle.tsx`.
  - 리포트: `src/app/(dashboard)/reports/page.tsx`, CSV 라우트 `src/app/api/reports/route.ts`.
  - 데모: `src/components/demo-data-button.tsx`(무디 샘플을 빠르게 채워 플로우 시드로 쓸 수 있음).

**배경**: 이 step은 **핵심 해피패스를 브라우저로 한 번 통과시키는 E2E 스펙**이다: 로그인(dev 테스트 로그인) → 클라이언트 생성 → 계약 생성 → 서명 → 인보이스 발행 → 정산(paid 토글) → 대시보드 KPI 반영 → CSV 내보내기. **데이터 흐름 체인이 끊기지 않는지**를 확인하는 것이 목적이다.

## 작업

### 1) 해피패스 스펙 — `e2e/happy-path.spec.ts`(신규, 필요 시 여정별로 파일 분할)

- **step 0의 인증 진입점으로 로그인 상태에서 시작**한다(직접 OAuth 금지 — dev 테스트 로그인).
- **여정(현실적 범위에서 재량으로 분할·병합)**:
  1. 대시보드 진입 확인.
  2. 클라이언트 생성(폼 제출) → 목록/상세에 반영 확인.
  3. 계약 생성(AI 초안은 실패해도 골격 폴백이므로 **초안 존재만 확인**, 특정 AI 텍스트에 의존 금지) → 조항 확정.
  4. 서명(`signature-pad` 캔버스) → 상태 `signed` 배지 확인.
  5. 인보이스 발행(계약 하위) → 원천징수/net 스냅샷 표시 확인.
  6. 정산 토글(unpaid→paid) → `paid` 배지 확인.
  7. 대시보드 KPI(이달 수익/미수금)·리포트에 반영 확인.
  8. CSV 내보내기 링크가 200 + `content-type: text/csv`를 반환하는지 확인(응답 헤더 검증).
- **셀렉터 원칙**: 가급적 role/label/text 기반(`getByRole`·`getByLabel`·`getByText`)으로 접근성 있는 셀렉터 사용. 취약한 CSS 체인·nth 인덱스 남발 금지. 필요하면 대상 컴포넌트에 **`data-testid`를 최소 추가**(step 3의 상태 점검과 겹치지 않게, 순수 마킹만).
- **AI·시간 의존 최소화**: 생성되는 금액/날짜는 스펙 안에서 입력값으로 고정하고 그 값을 assert. "오늘/이달"은 앱이 KST로 계산하므로, 플로우 내에서 만든 데이터가 이달에 잡히는지 정도만 확인(하드코딩된 특정 월 금지).

### 2) 실행 · 상태 판정

- `npx playwright test`로 실행한다. **아래 중 하나라도 없으면 실제 실행은 불가**하다:
  - 라이브 Supabase 프로젝트(`NEXT_PUBLIC_SUPABASE_URL`/키가 실제 동작),
  - 시드된 `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` 유저 + `ALLOW_TEST_LOGIN=true`,
  - Playwright 브라우저 바이너리(`npx playwright install chromium`).
- **이 경우 step을 `error`로 두지 말고 `blocked`로 처리**하라: 스펙 코드는 커밋하되 `"status": "blocked"`, `"blocked_reason"`에 **정확히 무엇이 없어서 실행 불가인지**(예: "라이브 Supabase/시드 유저/브라우저 바이너리 부재로 E2E 구동 불가 — 스펙 작성·컴파일은 완료") 기록한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test                     # 기존 vitest green(e2e 제외 유지)
npx playwright test --list   # 플로우 스펙이 컴파일·발견됨(브라우저/서버 불필요)
# 아래는 라이브 환경이 있을 때만:
npx playwright test          # 해피패스 통과(없으면 blocked)
```

## 검증 절차

1. `--list`까지의 AC는 항상 통과해야 한다(스펙이 TS 컴파일되고 발견됨). 라이브 환경이 있으면 전체 `npx playwright test`도 실행한다.
2. 체크리스트:
   - 로그인이 **dev 테스트 로그인**으로 이뤄지는가(직접 OAuth 아님)?
   - 여정이 **데이터 체인(계약→서명→인보이스→정산→대시보드→CSV)**을 끊김 없이 밟는가?
   - AI 초안의 **특정 텍스트에 의존하지 않는가**(골격 폴백 허용)?
   - 셀렉터가 role/label/text 기반인가(취약 셀렉터 남발 없음)?
   - CSV 검증이 응답 헤더(`text/csv`)를 확인하는가?
3. `phases/8-e2e/index.json`의 step 1 업데이트: 라이브 실행 통과 → `completed`+`summary`; 라이브 환경 부재로 실행 불가 → `blocked`+`blocked_reason`(스펙은 커밋); 스펙 컴파일 자체 실패(3회) → `error`+`error_message`.

## 금지사항

- 직접 Google OAuth를 E2E로 몰지 마라. 이유: 외부 인증 의존 — ADR-007은 dev 테스트 로그인으로 대체.
- AI 초안의 특정 문구를 assert 하지 마라. 이유: AI는 보강(실패 시 골격 폴백) — 플레이키.
- 특정 연/월을 하드코딩해 KPI를 assert 하지 마라. 이유: KST 현재월 계산 — 시간 의존 플레이키.
- E2E 자격증명/URL을 스펙에 하드코딩하지 마라. 이유: 시크릿 노출(전부 env).
- 라이브 환경이 없다고 step을 `error`로 두지 마라. 이유: 실행 환경 부재는 `blocked`(스펙 산출물은 유효).
- CI(`.github/workflows`)·상태 파일(step 3)을 만들지 마라. 이유: step 2·3 소관.
- 기존 테스트를 깨뜨리지 마라.

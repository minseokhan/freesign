# Step 3: state-audit

## 읽어야 할 파일

먼저 아래 파일들을 읽고 현재 상태 처리(로딩·빈·에러·피드백)의 실제 구현과 관례를 파악하라:

- `/docs/UX_PRINCIPLES.md` — **상태·피드백 원칙**(로딩·빈 상태·에러·성공 피드백이 이 step의 기준). `/docs/UI_GUIDE.md` — 빈 상태·토스트·문구.
- `/CLAUDE.md` — 컴포넌트는 `components/`, 외과적 변경(있는 걸 개선만, 재작성 금지).
- 이전 phase 산출물(**현황 파악 대상** — 있는 것/없는 것을 실제로 확인하라):
  - **이미 존재**: `src/app/(dashboard)/loading.tsx`, `src/app/(dashboard)/error.tsx`. 루트에는 상태 파일이 **없다**(확인 후 보강).
  - 라우트 목록(각 화면의 로딩/빈/에러/성공 피드백 점검 대상):
    - `src/app/(dashboard)/dashboard/page.tsx`, `reports/page.tsx`
    - `clients/page.tsx`·`[id]/page.tsx`·`new/page.tsx`, `contracts/*`, `invoices/*`, `settings/page.tsx`
    - `src/app/(auth)/login/page.tsx`, `src/app/page.tsx`
  - **기존 피드백 패턴(그대로 따르라 — 새 라이브러리 도입 금지)**:
    - `src/components/invoice-payment-toggle.tsx` — `useOptimistic` + 인라인 `message`(success/error) + 롤백.
    - `src/components/demo-data-button.tsx` — `window.confirm`(파괴적) + 인라인 `message`.
    - `src/components/client-delete-button.tsx` — 삭제 확인 패턴.
  - `src/components/ui/*` — Card·Button·Badge 프리미티브(빈 상태 UI 조립에 재사용).

**배경**: 이 step은 **전 화면의 상태 처리 감사·보강**이다 — 로딩(`loading.tsx`)·빈 상태·에러(`error.tsx`/`not-found.tsx`)·주요 뮤테이션의 성공/실패 피드백이 **존재하는지 점검하고, 빠진 곳만 최소로 채운다.** 새 기능·리팩토링이 아니다.

## 작업

### 1) 감사(먼저 목록화)

- 각 라우트별로 **로딩·빈 상태·에러·성공 피드백** 4항목의 존재 여부를 확인해 빠진 곳을 목록화하라. (RSC 페이지는 Suspense 경계의 `loading.tsx`, 데이터 0건 빈 상태, 세그먼트 `error.tsx`, 뮤테이션 컴포넌트의 인라인 message.)

### 2) 전역 상태 파일 보강(빠진 것만)

- 루트 **`src/app/not-found.tsx`**(404) 추가 — 없으면.
- 루트 **`src/app/global-error.tsx`**(루트 레이아웃 크래시 대비) 추가 — 없으면.
- **CRITICAL(App Router 규칙)**: `error.tsx`·`global-error.tsx`는 **`"use client"`** 이어야 하고 **`reset` 핸들러**를 제공해야 한다. `global-error.tsx`는 자체 `<html><body>`를 렌더한다. 이 규칙을 어기면 빌드/런타임 에러.

### 3) 라우트별 로딩/빈 상태 보강(빠진 것만)

- 데이터 목록 라우트(clients·contracts·invoices·reports 등)에 **세그먼트 `loading.tsx`가 없고** 유의미하면 최소 스켈레톤/스피너를 추가한다. 기존 `(dashboard)/loading.tsx`가 상위에서 이미 커버하면 **중복 추가하지 마라**(외과적).
- **빈 상태**: 데이터 0건일 때 각 목록이 안내 문구/CTA를 보여주는지 확인. 이미 있으면(예: 대시보드 "데모 데이터 채우기") **건드리지 마라.** 없는 목록만 UI_GUIDE 톤으로 최소 추가.

### 4) 성공/실패 피드백 점검

- 주요 파괴적/상태변경 액션(삭제·정산 토글·데모 채우기/지우기·계약 상태 전이)이 **성공/실패 피드백**을 노출하는지 확인. **기존 인라인 `message` 패턴을 따르고**, 누락된 곳만 동일 패턴으로 보강.
- **새 토스트 라이브러리(sonner 등)를 도입하지 마라** — 프로젝트는 인라인 message 패턴을 쓴다(스코프 크립·번들 증가).

## Acceptance Criteria

```bash
npm run lint
npm run build      # error.tsx/global-error.tsx의 "use client"·reset 규칙 위반 시 여기서 실패
npm test           # 기존 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 루트 `not-found.tsx`·`global-error.tsx`가 존재하는가? `error`류가 **`"use client"` + `reset`**인가?
   - 목록 라우트에 로딩·빈 상태가 (상위 커버 포함) 존재하는가? **중복 추가는 없는가**(외과적)?
   - 주요 뮤테이션이 성공/실패 피드백을 노출하는가? **기존 인라인 패턴**을 따랐는가(새 토스트 lib 없음)?
   - 기존 상태 파일/빈 상태를 불필요하게 재작성하지 않았는가?
3. `phases/8-e2e/index.json`의 step 3 업데이트: 성공 → `completed`+`summary`. 완료 시 **phase 8 전체 완료**(execute.py가 `phases/index.json`의 `8-e2e`도 기록).

## 금지사항

- 멀쩡한 기존 `loading.tsx`/`error.tsx`/빈 상태를 재작성하지 마라. 이유: 외과적 변경 — 빠진 것만 채운다.
- 새 토스트/알림 라이브러리를 추가하지 마라. 이유: 프로젝트는 인라인 message 패턴 — 스코프 크립·번들 증가.
- `error.tsx`/`global-error.tsx`를 서버 컴포넌트로 두거나 `reset`을 빼지 마라. 이유: App Router 규칙 위반 → 빌드/런타임 에러.
- 상태 점검을 핑계로 도메인 로직·쿼리·Server Action을 수정하지 마라. 이유: 이 step은 상태/피드백 UI 감사만.
- E2E 스펙·CI를 만들지 마라. 이유: step 0~2 소관.
- 기존 테스트를 깨뜨리지 마라.

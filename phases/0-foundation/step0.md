# Step 0: project-scaffold

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 기술 스택·아키텍처·설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 기술 스택, 디렉토리 구조(`src/app`·`components`·`types`·`lib`·`services`), 테스트 전략
- `/docs/ADR.md` — ADR-001(App Router), ADR-002(Supabase, ORM 없음), ADR-007(Vitest+Playwright)
- `/CLAUDE.md`, `/AGENTS.md` — CRITICAL 규칙과 하네스 실행 규칙

이 step은 phase 0(foundation)의 첫 step이며, 아직 코드가 전혀 없는 그린필드 상태에서 시작한다.

## 작업

Next.js 15 프로젝트의 **뼈대(scaffolding)**만 세운다. 기능 코드는 이후 step에서 붙인다.

1. **Next.js 15 + App Router + TypeScript strict** 프로젝트 생성.
   - 소스 루트는 `src/`, App Router는 `src/app/`. (ARCHITECTURE.md 디렉토리 구조 준수)
   - `tsconfig.json`은 `"strict": true` + path alias `@/*` → `src/*`.
   - `package.json` scripts: `dev`(next dev), `build`(next build), `lint`(eslint), `test`(vitest run).
2. **설정 파일**:
   - `next.config.ts` — 최소 설정. (PDF용 `outputFileTracingIncludes`는 이 step에서 넣지 마라 — PDF phase 담당)
   - ESLint **flat config**(`eslint.config.mjs`) + Prettier.
   - `.gitignore`는 이미 존재하니 Next.js 산출물(`.next`, `node_modules`, `next-env.d.ts`)이 무시되는지 확인하고 누락 시에만 추가.
3. **Vitest 셋업**:
   - `vitest.config.ts` — `environment: 'jsdom'`, path alias `@/*` 해석, `globals: true`.
   - `@testing-library/react` + `@testing-library/jest-dom` + `jsdom` 설치. setup 파일(`vitest.setup.ts`)에서 jest-dom matcher 등록.
   - **스모크 테스트 1개**(`src/lib/__tests__/smoke.test.ts` 또는 유사)를 작성해 `npm test`가 green이 되게 하라. `npm test`가 "테스트 없음"으로 실패하면 안 된다.
4. `src/app/layout.tsx`(최소 root layout)와 `src/app/page.tsx`(최소 플레이스홀더)를 만들어 `npm run build`가 통과하게 하라. 디자인·라우팅은 이후 step 담당이니 **내용은 최소로**.

Node 버전은 Next.js 15가 요구하는 LTS(18.18+ 또는 20+)를 가정한다.

## Acceptance Criteria

```bash
npm install
npm run build   # 컴파일·타입 에러 없음
npm run lint    # ESLint 통과
npm test        # 스모크 테스트 green (테스트 0개로 인한 실패 아님)
```

## 검증 절차

1. 위 AC 커맨드를 순서대로 실행한다.
2. 아키텍처 체크리스트:
   - 소스가 `src/` 아래에 있고 App Router가 `src/app/`인가? (ARCHITECTURE.md 구조)
   - `tsconfig.json`에 `strict: true`가 켜져 있는가?
   - ADR 스택(Next.js 15·Vitest)을 벗어나지 않았는가?
3. 결과에 따라 `phases/0-foundation/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "생성된 설정 파일·스크립트·테스트 셋업 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- Tailwind/shadcn/Supabase/PDF 관련 코드나 의존성을 넣지 마라. 이유: 각각 step 1·2·3, PDF phase의 소관이며 지금 넣으면 스코프가 섞이고 자기완결성이 깨진다.
- `next.config`에 `outputFileTracingIncludes`·`maxDuration` 같은 PDF/런타임 설정을 넣지 마라. 이유: 근거가 되는 PDF 코드가 아직 없어 죽은 설정이 된다.
- 라우트 페이지(dashboard·clients 등)를 만들지 마라. 이유: app-shell(step 4) 소관.
- 기존 테스트를 깨뜨리지 마라.

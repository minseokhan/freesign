# 프로젝트: FreeSign

이 파일은 Codex(및 하네스 `scripts/execute.py`)가 작업 시 따르는 프로젝트 규칙이다.
하네스는 각 step 실행 시 이 파일을 가드레일로 로드한다.
제품 범위·데이터 모델·유저 플로우 상세는 `docs/`(PRD·ARCHITECTURE·ADR·UI_GUIDE·DATABASE) 참조.

## 기술 스택
- Next.js 15 (App Router, RSC + Server Actions)
- TypeScript strict mode
- Tailwind CSS + shadcn/ui
- Supabase (Auth: Google OAuth · Postgres · Storage) — `@supabase/ssr` + 생성 타입, RLS로 `user_id` 스코프
- Claude API (`@anthropic-ai/sdk`) — 계약서 초안 및 기존 계약 PDF 조항 추출(시나리오 B)
- @react-pdf/renderer — 계약서·인보이스 PDF (Node 런타임)
- react-hook-form + zod, Vitest + Playwright

## 아키텍처 규칙
- CRITICAL: **읽기는 RSC에서 Supabase 직접 조회**(RLS 스코프), **쓰기는 Server Actions에서만**(`revalidatePath`로 갱신). 읽기를 내부 `/api` fetch로 우회하지 말 것.
- CRITICAL: **시크릿·외부 API**(Claude·서명 해시·PDF·CSV·`service_role`)는 `app/api/` 라우트 핸들러 또는 서버 전용 모듈에서만. 클라이언트 컴포넌트 직접 호출 금지. `service_role` 키는 요청 경로에서 절대 금지(CLI 시드에서만).
- CRITICAL: **모든 사용자 데이터는 RLS `USING` + `WITH CHECK (user_id = (select auth.uid()))` 둘 다** 스코프. Server Action은 **client 입력 전용 zod allowlist**(도메인 필드만)만 받고, `user_id`는 항상 `getUser()`에서, 서버 소유 필드(`status`·`paid_at`·`doc_hash`·`signature_meta`·`is_demo`·금액 스냅샷·pdf 경로)는 client 입력 금지. **FK 참조**(invoice→contract/client)는 Server Action에서 소유권 재조회 검증 후 insert(FK는 RLS 우회).
- CRITICAL: 전자서명·결제는 `services/`의 **v1 전용 Provider 인터페이스** 뒤로만 접근. AI 계약서 초안·PDF 추출 결과는 항상 비권위적 검토 보조로 취급·면책 노출, AI는 필수 게이트가 아닌 보강(실패 시 골격/수기 입력 폴백).
- 상태 전이(계약 status·인보이스 결제)는 **append-only 이벤트 로그에 함께 기록**(도메인 UPDATE 후 이벤트 INSERT, 순차). status 변경을 쓰기 순서 앞쪽에 두지 말 것(부분 실패 시 미완 방지).
- `deleted_at IS NULL` 필터는 RLS가 아니라 **공용 쿼리 헬퍼**에서(복원·감사·CSV 보존). Storage는 private 버킷 + `{user_id}/...` 경로, DB엔 key만 저장·읽기는 단기 signed URL.
- 서버 인가는 `getUser()`(`getSession()` 아님). middleware는 토큰 갱신 전용(보안 경계 아님).
- 컴포넌트는 `components/`, 타입은 `types/`, 순수 함수는 `lib/`(집계는 SQL, 변환만 JS)에 분리.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 하네스 실행 규칙
- 각 step은 이 파일에 명시된 작업만 수행하고, 요청되지 않은 기능/파일을 만들지 말 것.
- AC(Acceptance Criteria)를 직접 실행해 검증한 뒤 `phases/<phase>/index.json`의 step status를 갱신할 것.
- 사용자 개입(API 키, 인증, 수동 설정 등)이 필요하면 즉시 `blocked` 처리하고 중단할 것.

## Codex 가드레일 (`.codex/hooks.json`)
Codex 훅으로 다음 가드레일이 자동 적용된다(최초 1회 `/hooks` 에서 신뢰 승인 필요):
- `PreToolUse[Bash]` → 위험 명령(`rm -rf`, force push, `reset --hard`, `DROP TABLE`) 차단.
- `PreToolUse[apply_patch]` → 소스 파일에 대응 테스트가 없으면 편집 차단(TDD 강제). `components/`·`types/`·설정/스타일 파일은 예외.
- `Stop` → 턴 종료 시 `lint`/`build`/`test` 실행, 실패하면 수정을 이어가도록 유도(`package.json` 없으면 skip).

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # 테스트

## 하네스
python3 scripts/execute.py <phase-dir> [--push]   # phase의 step을 순차 실행 (codex exec 호출)
python3 -m pytest scripts/test_execute.py         # 하네스 테스트

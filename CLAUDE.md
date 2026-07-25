# 프로젝트: FreeSign

프리랜서 개인이 "계약 → 서명 → 청구 → 입금 → 세금 정리"를 하나의 데이터 흐름으로 관리하는 한국형 올인원. 방어 가능한 코어는 "계약 → 지급기한 → 입금/미수 증빙"의 기록 체인. 상세는 `docs/`(PRD·ARCHITECTURE·ADR·UI_GUIDE·DATABASE) 참조.

## 기술 스택
- Next.js 15 (App Router, RSC + Server Actions)
- TypeScript strict mode
- Tailwind CSS + shadcn/ui
- Supabase (Auth: Google OAuth · Postgres · Storage) — `@supabase/ssr` + 생성 타입, RLS로 `user_id` 스코프
- Claude API (`@anthropic-ai/sdk`) — 계약서 초안
- @react-pdf/renderer — 계약서·인보이스 PDF (Node 런타임)
- Polar (`@polar-sh/nextjs`) — 구독 결제(Free/Pro 플랜), webhook은 SECURITY DEFINER RPC 경계 (ADR-010, `lib/plan.ts` 게이팅)
- react-hook-form + zod, Vitest + Playwright

## 아키텍처 규칙
- CRITICAL: **읽기는 RSC에서 Supabase 직접 조회**(RLS 스코프), **쓰기는 Server Actions에서만**(`revalidatePath`로 갱신). 읽기를 내부 `/api` fetch로 우회하지 말 것.
- CRITICAL: **시크릿·외부 API**(Claude·서명 해시·PDF·CSV·`service_role`)는 `app/api/` 라우트 핸들러 또는 서버 전용 모듈에서만. 클라이언트 컴포넌트 직접 호출 금지. `service_role` 키는 요청 경로에서 절대 금지(CLI 시드에서만).
- CRITICAL: **모든 사용자 데이터는 RLS `USING` + `WITH CHECK (user_id = (select auth.uid()))` 둘 다** 스코프. Server Action은 **client 입력 전용 zod allowlist**(도메인 필드만)만 받고, `user_id`는 항상 `getUser()`에서, 서버 소유 필드(`status`·`paid_at`·`doc_hash`·`signature_meta`·`is_demo`·금액 스냅샷·pdf 경로)는 client 입력 금지. **FK 참조**(invoice→contract/client)는 Server Action에서 소유권 재조회 검증 후 insert(FK는 RLS 우회).
- CRITICAL: 전자서명·결제는 `services/`의 **v1 전용 Provider 인터페이스** 뒤로만 접근. AI 계약서 결과는 항상 "초안"으로 취급·면책 노출, AI는 필수 게이트가 아닌 보강(실패 시 골격 폴백).
- 상태 전이(계약 status·인보이스 결제)는 **append-only 이벤트 로그에 함께 기록**(도메인 UPDATE 후 이벤트 INSERT, 순차). status 변경을 쓰기 순서 앞쪽에 두지 말 것(부분 실패 시 미완 방지).
- `deleted_at IS NULL` 필터는 RLS가 아니라 **공용 쿼리 헬퍼**에서(복원·감사·CSV 보존). **단 계약(contracts)은 예외로 물리 삭제**(ADR-008, 마이그레이션 0013): 삭제 시 딸린 인보이스는 `contract_id`를 `SET NULL`로 끊고 `invoices.contract_snapshot`(jsonb, 서버 소유 필드)에 삭제 시점 계약 요약(`title`·`amount`·`start_date`·`end_date`)을 남겨 추적한다. 인보이스·클라이언트는 soft-delete 유지. Storage는 private 버킷 + `{user_id}/...` 경로, DB엔 key만 저장·읽기는 단기 signed URL.
- 서버 인가는 `getUser()`(`getSession()` 아님). middleware는 토큰 갱신 전용(보안 경계 아님).
- 컴포넌트는 `components/`, 타입은 `types/`, 순수 함수는 `lib/`(집계는 SQL, 변환만 JS)에 분리.
- 그 밖의 보안·데이터 접근·상태 전이 규칙은 `docs/ARCHITECTURE.md`(데이터 모델 규칙·데이터 흐름·패턴)·`docs/ADR.md` 참조.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD). `lib/tax.ts`·`lib/metrics.ts` 순수 함수와 상태 전이·보안 경계(RLS·소유권)는 특히 필수.
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # 테스트 (Vitest)
npx playwright test   # E2E

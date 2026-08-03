# 프로젝트: 매듭 (Maedeup)

프리랜서 개인이 "계약 → 서명 → 청구 → 입금 → 세금 정리"를 하나의 데이터 흐름으로 관리하는 한국형 올인원. 방어 가능한 코어는 "계약 → 지급기한 → 입금/미수 증빙"의 기록 체인. 상세는 `docs/`(PRD·ARCHITECTURE·ADR·UI_GUIDE·DATABASE) 참조.

## 기술 스택
- Next.js 15 (App Router, RSC + Server Actions)
- TypeScript strict mode
- Tailwind CSS + shadcn/ui
- Supabase (Auth: Google OAuth · Postgres · Storage) — `@supabase/ssr` + 생성 타입, RLS로 `user_id` 스코프
- Claude API (`@anthropic-ai/sdk`) — 계약서 초안 및 기존 계약 PDF 조항 추출(시나리오 B)
- @react-pdf/renderer — 계약서·인보이스 PDF (Node 런타임)
- Polar (`@polar-sh/nextjs`) — 구독 결제(Free/Pro 플랜), webhook은 SECURITY DEFINER RPC 경계 (ADR-010, `lib/plan.ts` 게이팅)
- Resend (`services/email`) — 서명 요청·청구 안내·독촉·크론 알림 메일. 전송 실패는 best-effort(주 트랜잭션과 분리)
- RFC 3161 TSA (`services/timestamp`) — 서명 발송·완결 시점 타임스탬프(기본 freeTSA.org, `TSA_URL`로 교체)
- Vercel Cron — 단일 일일 잡 `/api/cron/daily`가 독촉·반복 인보이스 스윕을 순차 실행 (ADR-011)
- react-hook-form + zod, Vitest + Playwright

## 아키텍처 규칙
- CRITICAL: **읽기는 RSC에서 Supabase 직접 조회**(RLS 스코프), **쓰기는 Server Actions에서만**(`revalidatePath`로 갱신). 읽기를 내부 `/api` fetch로 우회하지 말 것.
- CRITICAL: **시크릿·외부 API**(Claude·서명 해시·PDF·XLSX·`service_role`)는 `app/api/` 라우트 핸들러 또는 서버 전용 모듈에서만. 클라이언트 컴포넌트 직접 호출 금지. `service_role` 키는 요청 경로에서 절대 금지(CLI 시드에서만).
- CRITICAL: **모든 사용자 데이터는 RLS `USING` + `WITH CHECK (user_id = (select auth.uid()))` 둘 다** 스코프. Server Action은 **client 입력 전용 zod allowlist**(도메인 필드만)만 받고, `user_id`는 항상 `getUser()`에서, 서버 소유 필드(`status`·`paid_at`·`doc_hash`·`signature_meta`·`is_demo`·금액 스냅샷·pdf 경로)는 client 입력 금지. **FK 참조**(invoice→contract/client)는 Server Action에서 소유권 재조회 검증 후 insert(FK는 RLS 우회).
- CRITICAL: 전자서명·결제는 `services/`의 **v1 전용 Provider 인터페이스** 뒤로만 접근. AI 계약서 초안·PDF 추출 결과는 항상 비권위적 검토 보조로 취급·면책 노출, AI는 필수 게이트가 아닌 보강(실패 시 골격/수기 입력 폴백).
- CRITICAL: **세션 없는 경계(webhook·크론)의 멀티유저 쓰기는 시크릿 게이트 DEFINER RPC로만.** anon 클라이언트(`lib/supabase/anon.ts`) → `p_*_secret` 인자를 받는 `SECURITY DEFINER` 함수 → 내부에서 `billing_config`/`cron_config` 대조(fail-closed). 여기서도 `service_role` 금지 (ADR-010·011).
- CRITICAL: **세션 있는 경계의 파괴적 DEFINER RPC는 대상을 인자로 받지 않는다.** 계정 삭제처럼 RLS를 우회해 지우는 함수는 `auth.uid()`로 대상을 정하고 인자를 두지 않는다 — `p_user_id`를 받으면 로그인한 누구나 남의 계정을 지울 수 있다(앱이 옳게 넘겨줘도 PostgREST로 직접 호출 가능). 실행권은 `authenticated`에만 (ADR-012).
- CRITICAL: **크론은 클라이언트에게 직접 발송·발행하지 않는다.** 크론 산출물은 항상 소유자 검토 대기 상태(`pending_review`·인보이스 `draft`)이고, 실제 발송·발행은 세션 있는 Server Action에서만. 독촉 발송·반복 인보이스 스케줄은 추가로 `assertProFeature()`를 통과해야 한다(청구서 발송은 무료 — ADR-013).
- 상태 전이(계약 status·인보이스 결제)는 **append-only 이벤트 로그에 함께 기록**(도메인 UPDATE 후 이벤트 INSERT, 순차). status 변경을 쓰기 순서 앞쪽에 두지 말 것(부분 실패 시 미완 방지).
- `deleted_at IS NULL` 필터는 RLS가 아니라 **공용 쿼리 헬퍼**에서(복원·감사·리포트 보존). **단 계약(contracts)은 예외로 물리 삭제**(ADR-008, 마이그레이션 0013): 삭제 시 딸린 인보이스는 `contract_id`를 `SET NULL`로 끊고 `invoices.contract_snapshot`(jsonb, 서버 소유 필드)에 삭제 시점 계약 요약(`title`·`amount`·`start_date`·`end_date`)을 남겨 추적한다. 인보이스·클라이언트는 soft-delete 유지. Storage는 private 버킷 + `{user_id}/...` 경로, DB엔 key만 저장·읽기는 단기 signed URL.
- 서버 인가는 `getUser()`(`getSession()` 아님). middleware는 토큰 갱신 전용(보안 경계 아님).
- 컴포넌트는 `components/`, 타입은 `types/`, 순수 함수는 `lib/`(집계는 SQL, 변환만 JS)에 분리.
- 그 밖의 보안·데이터 접근·상태 전이 규칙은 `docs/ARCHITECTURE.md`(데이터 모델 규칙·데이터 흐름·패턴)·`docs/ADR.md` 참조.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD). `lib/tax.ts`·`lib/metrics.ts` 순수 함수와 상태 전이·보안 경계(RLS·소유권)는 특히 필수.
- UI·E2E 테스트의 기대값은 지금 화면에 뜨는 문구가 아니라 의도한 동작에서 정할 것. 구현 뒤 셀렉터를 화면에 맞추면 잘못된 UI를 테스트가 박제한다.
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드 (`.next`를 지우고 다시 만듦 — 켜져 있는 dev 서버가 깨진다)
npm run build:verify  # 검증용 빌드. `.next-verify`에 출력하므로 dev 서버에 영향 없음.
                      # CRITICAL: 컴파일 확인 목적이면 `npm run build`가 아니라 항상 이쪽을 쓸 것.
npm run lint     # ESLint
npm run test     # 테스트 (Vitest)
npx playwright test   # E2E

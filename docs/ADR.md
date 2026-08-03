# Architecture Decision Records

## 철학
**포트폴리오로 완결되면서 출시로 확장 가능하게.** 데이터 모델·구조는 프로덕션급으로 만들되, 규제·비용이 큰 부분(실 결제 PG, 법적효력 서명, 세무 신고)은 기록/원리 재현/수동 체크로 우회하고 어댑터 뒤에 둔다. MVP라 값싼 올바른 기본값만 담고, 동시성·트랜잭션 같은 스케일 장치는 v2. 방어 가능한 코어는 "계약 → 지급기한 → 입금/미수 증빙"의 기록 체인.

---

### ADR-001: Next.js 15 App Router (RSC + Server Actions)
**결정**: App Router 기반. 읽기는 Server Component 직접 조회, 쓰기는 Server Actions에서만.
**이유**: 시크릿(Supabase service key·Claude key)을 서버에 격리하기 쉽고, RSC 직접 조회로 읽기 API 라우트 보일러플레이트를 없앤다. Server Actions + `revalidatePath`로 뮤테이션·캐시 무효화가 일원화된다.
**트레이드오프**: RSC/Server Actions의 학습 곡선과 캐싱 함정. 클라이언트 상태 라이브러리의 편의를 포기(대신 서버를 단일 소스로).

### ADR-002: Supabase 순수 클라이언트 + 생성 타입 (ORM 없음)
**결정**: Prisma/Drizzle 같은 ORM 없이 `@supabase/ssr` 클라이언트 + Supabase CLI 생성 타입 사용. 마이그레이션은 Supabase CLI SQL. **RLS가 1차 접근제어.**
**이유**: Auth·Postgres·Storage·RLS를 한 스택으로 묶어 인프라를 최소화. RLS를 DB에 두면 앱 버그가 있어도 소유권 경계가 유지된다. 생성 타입으로 컴파일 타임 안전성 확보.
**트레이드오프**: ORM의 관계 쿼리·타입 추론 편의를 포기(수동 SQL·조인). RLS 정책을 직접 작성·검증해야 하며, 서버 인가는 반드시 `getUser()`(미들웨어는 보안 경계 아님)여야 함.

### ADR-003: Provider 어댑터로 서명·결제 우회 (v1 → v2 교체 지점)
**결정**: 전자서명은 `services/signature`의 `SignatureProvider`, 결제는 `services/payment`의 `PaymentProvider` 인터페이스 뒤에 둔다. v1은 간이 서명(캔버스+해시)·수동 상태 토글로 구현.
**이유**: 규제·비용이 큰 실 서명 API·PG 연동을 나중에 인터페이스 교체만으로 붙일 수 있게. v1은 원리(무결성 증빙·정산 상태)를 재현해 포트폴리오로 완결.
**트레이드오프**: v2 실 API는 비동기·웹훅·리다이렉트라 인터페이스만으로는 안 되고 별도 재설계가 필요(어댑터는 "교체 지점 표시"일 뿐 완전한 추상화는 아님). v1은 법적효력·실결제 없음(면책으로 명시).

### ADR-004: AI 계약서 = 템플릿 골격(코드) + Claude 하이브리드
**결정**: 계약서 골격·필수조항 체크리스트는 코드가 소유하고, Claude는 (a) 범위 서술을 조항 문구로 다듬기, (b) 조항별 평문 요약만 담당. tool-use/JSON 출력 + zod 검증(`{title, body, plain_summary, needs_review}`). **AI는 필수 게이트가 아닌 보강** — 실패·타임아웃 시 템플릿 골격만 draft 저장 + 멱등 재시도.
**이유**: LLM에 계약서 전체를 맡기면 법조문 창작·필수조항 누락 위험. 골격을 코드가 쥐면 구조적 안전성 + AI의 문구 다듬기 가치를 동시에 얻는다. 프롬프트 가드레일("새 법조문/판례 창작 금지, 불명확하면 `[검토 필요]`")과 폴백으로 AI 장애가 기능을 막지 않게.
**트레이드오프**: 템플릿 골격이 범용 용역계약서 1종으로 제한됨(다종은 v2). AI 호출당 비용·지연 발생(prompt caching·유저별 상한으로 완화). 출력은 항상 "초안·비권위적", 어떤 행위도 자동 실행 안 함.

### ADR-005: @react-pdf/renderer, Node 런타임 서버 라우트에서 생성
**결정**: PDF는 `@react-pdf/renderer`로 서버 라우트(`runtime='nodejs'`)에서 생성. `next.config`의 `outputFileTracingIncludes`로 폰트/wasm(yoga·fontkit) 포함 + `maxDuration` 상향. Pretendard TTF **한글 전영역 임베드**(동적 텍스트라 서브셋 불가).
**이유**: React 컴포넌트로 PDF를 선언적으로 작성. 서버 생성이라 폰트·시크릿을 클라이언트에 노출하지 않음. 한글 전영역 임베드로 어떤 동적 텍스트도 깨지지 않게.
**트레이드오프**: 전영역 폰트 임베드로 PDF 용량 증가. Edge 런타임 불가(Node 전용), 번들에 wasm/폰트를 명시적으로 포함해야 하는 배포 설정 부담. 콜드 스타트·`maxDuration` 내 생성 압박.

### ADR-006: 정산은 상태 머신 + append-only 이벤트 로그 (수동 토글)
**결정**: 실 PG 없이 `payment_status`(draft→unpaid→paid, 되돌리기 허용) 수동 토글. 모든 상태 전이(계약·인보이스)는 `contract_events`/`invoice_events`에 append-only로 기록하고 상세 화면에 이력 타임라인으로 노출. 원천징수·금액은 발행 시점 스냅샷.
**이유**: 프리랜서 실무는 계좌이체 + 수동 확인이 자연스러움. 이벤트 로그가 "증빙 기록 체인"(방어 가능한 코어)을 실제로 보여준다. 스냅샷으로 발행 후 세율·금액 drift 방지.
**트레이드오프**: 자동 입금 확인 없음(수동 오토글 가능 → 되돌리기로 정정). 도메인 변경 + 이벤트 기록은 단일 트랜잭션 RPC(`*_with_event` 함수군, `0012_domain_event_functions.sql` — `sign_contract_with_event`·`issue_invoice_with_event`·`set_invoice_payment_with_event`·`transition_contract_status_with_event`·`import_signed_contract_with_event`)로 원자화해 부분 실패를 방지한다(당초 v2로 미뤘으나 v1에서 앞당겨 구현). 두 탭 동시 편집은 last-write-wins.

### ADR-007: E2E 포함 풀 테스트 커버리지 (Vitest + Playwright)
**결정**: Vitest(순수 함수 `lib/tax.ts`·`lib/metrics.ts`, API 통합) + Playwright(로그인~정산~리포트 실사용 플로우) + GitHub Actions CI. 새 기능은 테스트 먼저(TDD). OAuth E2E는 dev 전용 테스트 로그인 경로로 대체.
**이유**: 정산 계산·상태 전이·보안 경계(RLS·소유권)는 회귀가 치명적이라 자동 검증이 필수. AC를 실행 가능한 커맨드로 두어 하네스가 자율 검증하게.
**트레이드오프**: 초기 셋업·유지 비용 증가. dev 테스트 로그인은 백도어 리스크 → 이중 가드(빌드 타임 제외 + `NODE_ENV!=='production'`) + 프로덕션 빌드 시 404 검증으로 방어.

### ADR-008: soft-delete(`deleted_at`) 통일 + `is_demo` 플래그
**결정**: 도메인 3테이블 모두 `deleted_at` soft-delete로 통일(기록 체인·증빙 보존). `is_demo` 플래그로 데모 데이터만 선별 물리 삭제. `deleted_at IS NULL` 필터는 RLS가 아니라 공용 쿼리 헬퍼에서 적용.
**이유**: 정산 증빙·감사·세금 CSV는 삭제 후에도 보존돼야 하므로 물리 삭제 대신 soft-delete. 데모는 "채우기/지우기"로 비파괴 탐색을 지원. RLS에 필터를 넣으면 soft-delete 행이 복원·감사에서 사라져 목적과 충돌.
**트레이드오프**: 모든 공용 쿼리가 헬퍼를 거쳐야 함(직접 조회 시 삭제 행 노출 위험). FK `ON DELETE RESTRICT` + 앱 레이어 하위 존재 검사로 부모 삭제를 막아야 하는 복잡도. 데모 삭제는 이벤트 선삭제 순서를 지켜야 FK RESTRICT와 충돌하지 않음.
**갱신(2026-07-14)**: 계약(contracts)만 이 결정을 뒤집어 **물리(hard) 삭제**로 전환한다(인보이스·클라이언트는 soft-delete 유지). 계약은 소유자가 상태와 무관하게 삭제할 수 있고, 삭제 시 (1) 딸린 인보이스는 보존하되 `contract_id`를 `ON DELETE SET NULL`로 끊고 삭제 시점의 계약 핵심 정보(제목·금액·기간)를 `invoices.contract_snapshot(jsonb)`에 스냅샷으로 남겨 맥락 없는 고아를 방지, (2) 계약 감사 이벤트(`contract_events`)는 `ON DELETE CASCADE`로 함께 제거(append-only delete 정책 부재를 cascade가 우회), (3) Storage 아티팩트는 best-effort로 제거한다. **이유**: 계약은 인보이스와 달리 그 자체가 세금 신고 대상이 아니고, 미성사·오입력 계약을 완전히 지우려는 실제 요구가 있어 soft-delete 잔존이 오히려 노이즈. 증빙 체인의 핵심인 "왜 받았는지"는 인보이스 스냅샷이 대신 보존한다. 관련 정책: `contracts_delete_own`(소유자 delete), `contract_artifacts_delete_own`(Storage delete). 마이그레이션 `0013_contract_hard_delete.sql`.

### ADR-009: 쌍방 전자서명 v2 — sent 상태·anon DEFINER RPC 경계·증거 보존
**결정**: 상대방(비로그인) 맞서명을 자체 구현하며(마이그레이션 `0017`~`0020`, `docs/SIGNATURE_V2_PLAN.md`) 다음 다섯 가지를 확정한다.
1. **`sent` 상태 도입** — 상태 머신을 draft → sent → signed로 확장(`contract_status`에 `sent` 추가). 발송 즉시 조항 편집이 잠기고(`updateContractClauses`는 draft만 허용), 조인 없이 목록·전이 가드를 처리한다. sent/signed 진입은 일반 상태 전이 UI가 아닌 전용 절차(발송/서명 RPC)에서만 허용.
2. **anon 접근은 SECURITY DEFINER RPC 경계** — 비로그인 서명자는 테이블에 직접 접근할 수 없고(anon RLS 정책 없음), `search_path = public, pg_temp` 고정 + anon grant된 DEFINER 함수(`get_signing_session`·`complete_counterparty_signature_with_event`·`get_certificate_data`·`store_completion_tsa_token`·`get_signed_contract_data`·`consume_anon_rate_limit`)로만 통과한다. CLAUDE.md의 "요청 경로 service_role 금지"를 지키면서 RLS 우회 표면을 함수 몇 개로 국한.
3. **상대 서명 이미지는 DB 저장(base64 text, ≤256KB CHECK)** — "Storage엔 파일, DB엔 key만" 규칙의 **명시적 예외**. anon은 Storage RLS를 통과할 수 없고(토큰 검증을 storage 정책으로 표현 불가), 캔버스 PNG는 ~30KB라 실용적이며 서명 행과 증거가 결합된다.
4. **counterparty 서명 존재 시 계약 삭제 차단** — ADR-008의 계약 물리 삭제에 예외를 둔다. 상대방 서명은 상대방의 증거이므로 소유자가 일방 파기할 수 없다. 앱 레이어 사전 체크(UX 안내) + DB BEFORE DELETE 트리거(최후 방어선) 이중 가드, signed→draft 되돌리기도 동일하게 차단(앱 가드 + RPC 가드). 무효화가 필요하면 삭제 대신 '취소' 상태 전이를 쓴다. `contract_signatures`는 update/delete 정책이 없는 불변 증거 테이블.
5. **TimestampProvider(RFC 3161) 어댑터** — "운영자가 해시를 나중에 조작하지 않았다"를 제3자 TSA 토큰(TST)으로 증명(`services/timestamp/`, 기본 freeTSA.org, `TSA_URL` env로 국내 공인 TSA 교체 가능). 발송 시점(frozen_doc_hash)과 완결 시점(결합 다이제스트) 2회 스탬프하며, RPC 커밋 후 best-effort — 실패해도 서명 플로우를 막지 않고 완결증명서에 "타임스탬프 미확보"로 명시한다(과대표시 금지).

**이유**: 외부 서명 SaaS 없이(건당 비용 0원) "이메일 소유확인 + 발송 시점 해시 동결 + 감사추적 + 완결증명서 + TSA"로 입증력의 실체를 재현한다(`docs/LEGAL_SIGNATURE.md`). legalEffect는 "효력 있음/없음" 이분법 대신 입증력 단계(`record` 단독 기록 / `mutual` 맞서명)로 표기한다.
**트레이드오프**: anon DEFINER RPC는 신규 공격 표면(반환 필드 최소화·입력 상한·search_path 고정·레이트리밋으로 완화, advisor 재점검 필요). 이메일 소유확인 수준이라 토큰 URL 소지자가 서명 가능(본인인증 승급은 확장 지점만 확보). 서명 이미지 DB 저장으로 행 크기 증가. 무료 공용 TSA는 국내 공인 TSA 대비 법원 관행 신뢰도가 낮음(엔드포인트 교체로 승급 가능).

### ADR-010: 유료화 — Polar 결제 + Free/Pro 경계 + SECURITY DEFINER webhook
**결정**: 구독 결제를 Polar(`@polar-sh/nextjs`)로 붙이고(마이그레이션 `0024`, `docs/BILLING_PLAN.md`) 다음을 확정한다.
1. **Free/Pro 경계 = "불러오기 Free / 새 계약 생성·서명 Pro"** — 이미 서명된 외부 계약 **불러오기**(AI 파싱, 누적 5회)와 인보이스·클라이언트·입금추적은 무료(기록 체인 락인). 앱에서 **새 계약 생성 → 쌍방 서명 → TSA → 완결증명서**로 도는 풀 워크플로우는 Pro. 단 activation을 위해 무료도 **새 계약 생성·서명을 1건 체험**(2건째부터 Pro). 세금 CSV export·고급 대시보드(채널·클라이언트 랭킹)도 Pro. 서명·TSA·증명서는 "새 계약 생성"에만 존재하므로 별도 게이트 없이 자동 Pro.
2. **게이팅 방식 — 상한별 이원화**: 불러오기 파싱은 저장 없는 호출도 토큰 비용이 나가므로 `usage_counters` 누적 카운터(`consume_lifetime_quota`)로 "호출 자체"를 카운트. 새 계약 생성·서명은 별도 카운터 없이 **`contracts` 실시간 count**(`source_pdf_url IS NULL` = 생성 계약)로 판정 — 실데이터 기반이라 **다운그레이드(pro때 만든 계약이 그대로 카운트) 시 "기존 읽기전용 유지, 신규만 재적용" 정책과 자동 일치**. 모든 게이트는 **free일 때만** 검사하므로 업그레이드는 즉시 무제한.
3. **플랜 판정은 순수 함수 `derivePlan`**(`lib/plan.ts`) — 행 없음/plan=free/revoked→free, 기간 만료→free, 취소예정이나 기간 잔여→pro 유지(유예). `mapPolarStatusToPlan`이 Polar status→내부 상태 매핑(active/trialing/past_due→pro, 그 외→free).
4. **Webhook은 SECURITY DEFINER RPC 경계** — Polar webhook은 로그인 세션이 없어 남의 구독 행을 써야 한다. `service_role`(마스터키)을 요청 경로에 두는 대신, 서명 검증 후 **anon 클라이언트**(`createAnonClient`)로 `upsert_subscription_from_polar`(DEFINER) 하나만 호출해 구독 행 upsert + `billing_events` 기록. anon 직접 호출로 남을 pro로 올리는 권한상승을 막기 위해 **webhook 시크릿을 파라미터로 받아 `billing_config`(RLS·grant로 anon/authenticated 조회 차단, DEFINER만 읽음)의 저장값과 대조**(미설정 시 fail-closed). ADR-009의 anon DEFINER 경계 컨벤션 재사용. (Supabase `postgres` 롤은 커스텀 GUC ALTER 권한이 없어 GUC 대신 테이블에 시크릿을 둔다 — 0026.)

**이유**: 무료의 방어 가능한 코어(기록 체인)는 온전히 열어 락인하고, 히어로 기능(생성→서명→TSA→증명서)의 무제한만 과금한다. webhook의 DEFINER+GUC 게이트로 "요청 경로 service_role 금지"(CLAUDE.md CRITICAL)를 지키면서 권한상승 구멍도 없앤다.
**트레이드오프**: Polar(MoR·미국법인)는 한국 발급 카드 결제만 가능하고 카카오페이·네이버페이·계좌이체 등 국내 간편결제·한국 세금계산서(홈택스) 발급 미지원 — 사업자·카드 기피층 전환 손실을 감수하며, 마찰이 크면 향후 국내 PG(토스페이먼츠·페이플) 이전 재평가(`docs/BILLING_PLAN.md` 열린 항목). 불러오기 카운터는 성공/실패 무관 "파싱 호출"을 세므로 preview 남용도 상한에 포함(비용 기준으로 의도된 것).

**갱신(2026-07-25)**: 상한 구조(2·3·4항)는 유지하되 **Pro의 정체성을 "무제한 계약 생성" → "청구·수금 자동화 + 인사이트"로 재배치**한다(ADR-011). 이유는 위 1항의 결함이다 — 매달 쓰는 가치(인보이스·입금추적)는 전부 Free인데 Pro의 대표 가치(새 계약 생성·서명)는 몰아서 쓰는(bursty) 기능이라, "계약 1건 → 몇 달 작업"인 프리랜서에게 월 구독의 정당성이 매달 서지 않는다. 그래서 매달 가치가 발생하는 3기능(미수금 자동 독촉·반복 인보이스·AI 계약 인사이트)을 Pro로 신설했다. 현재 경계는 `src/components/billing/plan-comparison.tsx`가 사용자에게 보여주는 목록이 정본이다:
- **Free** — 클라이언트·인보이스 무제한, 새 계약 1건·서명 발송 1건, 불러오기 파싱 누적 5회, 미수금·이달 수익 대시보드, 계약서·인보이스 PDF.
- **Pro** — 위 상한 전부 무제한 + 반복 인보이스 자동 초안 + 미수금 독촉 메일 초안 + AI 계약 인사이트 + 채널/클라이언트 수익 랭킹 + 세금 CSV.
- **다운그레이드해도 데이터는 지우지 않는다** — 자동화와 뷰만 잠근다(반복 스케줄은 행을 남긴 채 생성만 중단). 요금제 화면은 `/settings`의 카드에서 전용 페이지 `/billing`으로 분리했고, Pro 전용 메뉴(반복 인보이스)는 free에게 사이드바에서 아예 숨긴다.

### ADR-011: Pro 자동화 3기능 — 단일 일일 크론 + "초안까지만" 반자동
**결정**: 월 구독을 정당화하는 Pro 자동화 3기능(미수금 독촉·반복 인보이스·AI 계약 인사이트)을 붙이며(마이그레이션 `0027`~`0031`, `docs/PRO_FEATURES_PLAN.md`) 다음을 확정한다.
1. **스케줄러는 Vercel Cron 단일 일일 잡** — Hobby 플랜이 "1일 1회 + 잡 수 제한"이라 기능별 크론 대신 `/api/cron/daily`(21:00 UTC = 06:00 KST) 하나가 dunning·recurring 스윕을 순차 호출한다. 각 스윕은 try/catch로 격리해 하나가 죽어도 나머지가 돈다. pg_cron·Supabase Functions를 새로 들이지 않고 기존 API Route 패턴에 최소 표면으로 얹는다.
2. **크론의 멀티유저 쓰기는 시크릿 게이트 DEFINER RPC로만** — 세션 없는 크론은 남의 행을 써야 한다. ADR-010의 billing 패턴을 그대로 재사용: anon 클라이언트 → `p_cron_secret` 인자를 받는 `SECURITY DEFINER` RPC → 첫 줄에서 `assert_cron_secret`이 `cron_config`(RLS enabled + 정책 없음 + anon/authenticated grant 회수) 저장값과 대조해 fail-closed. 라우트 진입은 `Authorization: Bearer ${CRON_SECRET}`로 한 번 더 막는다. `service_role`은 여기서도 금지.
3. **크론은 초안까지만 만든다(반자동)** — 크론 산출물은 항상 소유자 검토 대기 상태다(`dunning_reminders.status='pending_review'`, 반복 인보이스는 `draft`). 클라이언트에게 나가는 메일·인보이스 발행은 세션 있는 Server Action에서 `assertProFeature()` 통과 후에만. 크론이 소유자에게 보내는 "검토 대기" 알림만 자동 발송이다.
4. **AI는 여기서도 보강, 게이트 아님** — 독촉 본문·계약 인사이트 모두 `tool_use` 강제 + zod 검증 + 결정론적 폴백(정중한 한국어 독촉문 / 중립 인사이트)을 두고 `ai_source`·`source` 컬럼에 `'ai' | 'fallback'`을 남긴다. 인사이트는 크론과 무관한 온디맨드(Pro API)이며, 결과는 `/api/contracts/draft`에서 `prior_insights`로 새 초안에 되먹임된다. 표기는 "비법률자문·검토보조".
5. **세금 계산 중복 금지** — 반복 스케줄의 원천징수는 스케줄 생성 시 `calcWithholding`(`lib/tax.ts`)으로 계산해 행에 스냅샷하고, 크론 RPC는 그 값을 순수 복사만 한다(SQL에 세율 로직을 두지 않는다). 다음 생성일은 `lib/recurring/schedule.ts`의 순수 함수가 Postgres `date + interval`(월말 클램프 포함)과 등가로 계산한다.
6. **멱등성은 DB 제약으로** — 인보이스당 미검토 독촉 초안 1건(`(invoice_id) WHERE status='pending_review'` 부분 유니크) + RPC의 cooldown/NOT EXISTS 가드. 크론 재실행·중복 호출이 같은 사람에게 두 번 독촉하지 않는다.

**이유**: "매달 가치가 발생하는 기능"을 Pro에 두되(ADR-010 갱신), 자동 발송이 오발송으로 신뢰를 깨는 것이 프리랜서-클라이언트 관계에서 가장 큰 리스크다. 그래서 자동화의 이득(초안 작성·주기 추적)만 취하고 대외 커뮤니케이션의 최종 결정권은 사람에게 남긴다. 보안 경계는 새로 발명하지 않고 검증된 billing 패턴을 복제해 리뷰 표면을 줄인다.
**트레이드오프**: 일 1회 크론이라 지연이 최대 24시간(연체 독촉·주기 인보이스에는 충분하지만 실시간 감각은 없음). 승인 단계 때문에 "완전 자동"을 기대한 사용자에겐 손이 한 번 더 간다. 크론 시크릿은 env와 DB(`cron_config`)에 이중 주입해야 하며 불일치 시 조용히 전부 실패한다(운영 함정 — 마이그레이션 후 수동 update 필요). 크론 스윕은 유저 수에 선형이라 대량 사용자에서는 배치·큐 재설계가 필요하다.

### ADR-012: 계정 삭제 — auth.uid() DEFINER RPC + 결제 기록만 익명 보존
**결정**: 회원 탈퇴를 즉시 완전 삭제로 구현하며(마이그레이션 `0047`~`0048`, `docs/LEGAL_ACCOUNT_PLAN.md`) 다음을 확정한다.
1. **`service_role` 대신 `auth.uid()` 기반 `SECURITY DEFINER` RPC** — Supabase 표준 경로인 `auth.admin.deleteUser()`는 `service_role`을 요구하는데 요청 경로에서 이는 금지다. 대신 인자를 하나도 받지 않는 `delete_own_account()`가 `auth.uid()`로 대상을 정한다. 세션 있는 경계라 ADR-010·011의 시크릿 게이트(`p_*_secret`)는 필요 없다 — 세션 자체가 인가다. **인자가 없다는 점이 핵심**으로, 삭제 대상을 클라이언트가 지정할 수 없다.
2. **cascade 정비를 선행(0047)** — `0001`·`0018`이 만든 8개 테이블은 `references auth.users(id)`에 삭제 동작을 지정하지 않아 NO ACTION이었다. 이름을 나열하는 대신 "auth.users를 참조하는 NO ACTION FK"를 훑어 cascade로 바꾸고, 이후 추가분은 테스트가 잡는다(`src/lib/db/__tests__/account-delete.test.ts`가 NO ACTION 0건을 단언).
3. **cascade만으로는 안 되므로 RPC 안에서 순서대로 지운다** — `contracts.client_id`·`invoices.client_id`는 `ON DELETE RESTRICT`다. RESTRICT는 같은 문장에서 자식이 함께 지워져도 즉시 위반으로 판정하므로 `auth.users` 하나만 지우면 실패한다. `invoice_events → invoices → contracts → clients` 순으로 명시 삭제한 뒤 계정을 지운다. RESTRICT 자체는 "계약이 붙은 클라이언트는 못 지운다"는 제품 규칙이라 유지한다.
4. **결제 기록만 익명 보존** — 전자상거래법상 대금결제 기록 5년 보존 의무와 완전 삭제가 충돌한다. `billing_events`는 cascade로 함께 사라지므로, 삭제 직전에 FK 없는 `billing_records_retained`로 화이트리스트 컬럼만(고객·구독 식별자, 이벤트 종류, 시각) 옮긴다. `meta` jsonb는 어떤 PII가 들어 있는지 보증할 수 없어 이관하지 않는다. 이 테이블은 RLS를 켜고 **정책을 하나도 두지 않아** PostgREST로는 아무도 읽지 못한다.
5. **활성 구독이면 거부** — 구독이 살아 있는 채 계정만 지우면 Polar 쪽 구독이 남아 결제가 계속된다. `status in ('active','trialing','past_due')`면 예외로 되돌리고 UI가 `/billing`으로 유도한다.
6. **Storage → DB 순서** — 업로드 파일(`contract-artifacts`의 `{user_id}/...`)을 먼저 지우고 그다음 계정을 지운다.

**이유**: 개인정보보호법상 파기 의무와 Google OAuth 정책이 계정 삭제 경로를 요구하는데, 이 프로젝트의 보안 규약(`service_role` 금지)과 Supabase 표준 경로가 정면으로 충돌했다. DEFINER RPC는 이미 webhook·크론에서 검증된 패턴이라 새 경계를 발명하지 않고 재사용한 것이다. FK 삭제 규칙의 상호작용(3항)은 모킹으로 잡히지 않아 embedded-postgres에 실제로 걸어 검증한다.
**트레이드오프**: 6항의 순서에는 원자성이 없다. 뒤집으면 계정이 사라진 뒤 세션이 죽어 서명 이미지·계약 PDF를 지울 수단이 없어져 **개인정보가 영구히 남는다**. 지금 순서의 최악은 "파일은 지웠는데 계정이 남음"인데 재시도로 해소되므로 덜 나쁜 실패를 골랐다(실패 시 `captureServerException`으로 관측). 즉시 삭제라 오조작 복구가 불가능해 확인 문구 입력을 요구한다. 2항의 훑기는 마이그레이션 시점의 상태만 바꾸므로, 이후 새 테이블에 cascade를 빠뜨리면 테스트가 잡을 때까지 드러나지 않는다.

### ADR-013: 청구 전달 — 공개 청구서 토큰 + 발행/도달 이벤트 분리
**결정**: 인보이스를 클라이언트에게 실제로 전달하는 경로를 만들며(마이그레이션 `0046`, `docs/INVOICE_DELIVERY_PLAN.md`) 다음을 확정한다.
1. **서명의 공개 토큰 패턴을 청구 단계에 복제** — 새 경계를 발명하지 않는다. `invoice_share_tokens`는 `signature_requests`(0018)와 동형이고(원문 미저장·sha256 해시만·인보이스당 활성 1건 partial unique·만료), 공개 열람은 `get_invoice_view`(anon DEFINER, ADR-009 컨벤션)로만 연다. 테이블 쓰기 권한·정책은 두지 않고 `send_invoice_with_event`(DEFINER, 소유자 스코프)만 쓴다(0036 락다운 방침).
2. **발행(`invoice.issued`)과 도달(`invoice.sent`)을 두 이벤트로 나눈다** — 토큰이 DB에 있어야 링크가 유효하므로 "메일 먼저"가 불가능하다(서명 요청과 같은 제약). 그래서 토큰·발행은 RPC 한 트랜잭션에서 커밋하고, 메일은 커밋 뒤 best-effort로 보내며 **성공했을 때만** `append_invoice_event('invoice.sent')`를 남긴다. 커밋 시점에 미리 남기면 "보냈다고 기록됐는데 안 간" 상태가 증거로 굳는다.
3. **발행만 하는 경로를 남기지 않는다** — `publishDraftInvoice`를 유지하지 않고 `sendInvoice`로 대체했다. 발행과 발송이 분리돼 있으면 "앱에서 발행하고 청구는 카톡으로"라는 원래의 구멍이 그대로 남는다. 클라이언트 이메일이 없으면 메일 없이 링크만 발급하고 소유자가 직접 전달한다.
4. **만료는 지급기한 기준** — 서명 토큰의 14일은 연체 독촉 시점에 이미 죽어 링크가 무용지물이 된다. `due_date + 90일`(최소 now+30일, 상한 365일)로 잡고 RPC는 400일 상한만 검증한다.
5. **무료 기능, 방어는 레이트리밋으로** — 독촉·반복 인보이스와 달리 Pro 게이트를 두지 않는다. 청구 전달은 코어 흐름이지 부가 자동화가 아니며, 막으면 무료 사용자는 다시 앱 밖으로 나간다. 남용은 `RATE_LIMITS.invoiceSend`(5/60s, 서명·독촉과 동형)로 막는다.
6. **계좌는 공개 페이지·PDF 모두에 표시** — 계좌는 청구 목적상 상대에게 알려야 하는 정보이고, 링크 없이 메일 본문에 적어 보내던 현재보다 노출이 늘지 않는다. `invoice_id`도 반환하는데, PDF 문서번호가 인보이스 id라 클라이언트 사본과 소유자 사본의 번호가 같아야 대조가 되기 때문이다(소유자 라우트는 세션+RLS로 막히므로 id를 알아도 열람 권한이 생기지 않는다).

**이유**: 방어 가능한 코어가 "계약 → 지급기한 → 입금/미수 증빙"의 기록 체인인데, 청구 단계에만 클라이언트로 나가는 경로가 없어 체인의 중간 한 마디가 앱 밖(카톡·개인 메일)에 있었다. 앱이 증명할 수 있는 것은 "내가 발행 버튼을 눌렀다"뿐이라 혼자 쓴 메모와 증거 가치가 같았다. 2항이 이 ADR의 핵심으로, "청구한 날"의 증거가 실제 도달에만 붙게 만든다.
**트레이드오프**: 원문 토큰을 저장하지 않으므로 **재발송은 항상 재발급**이고 이전 링크는 죽는다 — 독촉 메일에 링크를 실으려면 그 시점에 토큰을 새로 발급해야 하고, 그 메일이 발송 실패하면 클라이언트가 갖고 있던 멀쩡한 링크만 무효화된다(소유자의 재발송으로 복구). 토큰 유출은 금액·계좌 노출을 뜻하므로 만료·회수·IP 레이트리밋·noindex에 의존하며, 서명과 달리 링크 수명이 길어 노출 창이 더 크다. 0046 이전에 발행된 인보이스는 토큰이 없어 백필하지 않고 소유자 UI의 재발송으로 사후 발급한다.

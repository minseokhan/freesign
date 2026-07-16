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

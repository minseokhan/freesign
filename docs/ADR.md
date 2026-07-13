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

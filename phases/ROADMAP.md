# FreeSign 하네스 로드맵 (phase 1~8 설계도)

> **이 문서의 목적**: `phases/index.json`에 등록된 9개 phase 중 상세 step 파일이 아직 없는 phase(1~8)를,
> **새 세션에서도 phase 0과 동일한 품질·형식으로** 작성할 수 있게 설계 의도를 못박아 둔 문서.
> phase 0(`0-foundation/`)의 step 파일들이 **형식의 레퍼런스**다 — 새 phase를 쓰기 전에 반드시 읽어라.
> 제품 스펙 원본은 `docs/`(PRD·ARCHITECTURE·ADR·UI_GUIDE·UX_PRINCIPLES)·`SCENARIO.md`. 이 문서는 그것을 하네스 step으로 쪼갠 지도일 뿐이다.

---

## 0. step 파일 작성 규약 (모든 phase 공통 — phase 0에서 확립됨)

새 phase의 `index.json` + `stepN.md`를 만들 때 반드시 지킬 것:

1. **자기완결성** — 각 step은 독립 세션에서 실행된다. "이전 대화에서" 같은 외부 참조 금지. 필요한 정보는 파일 안에 다 적는다.
2. **읽어야 할 파일** 섹션 — 관련 `docs/*.md` 경로 + **이전 step에서 생성/수정된 실제 파일 경로**를 명시.
3. **시그니처 수준 지시** — 함수/타입 인터페이스만 제시하고 구현은 에이전트 재량. 단 **핵심 규칙(멱등성·보안·데이터 무결성)은 명시적으로 박아라.**
4. **AC = 실행 커맨드** — `npm run build && npm run lint && npm test`(+ 필요 시 `npx playwright test`). 추상 서술 금지.
5. **금지사항 = "X 하지 마라. 이유: Y"** 형식. 특히 **다음 phase 소관 작업을 당겨오지 마라**(스코프 크립 방지).
6. **status 업데이트 프로토콜** — 각 step 끝에: 성공 `completed`+`summary`, 3회 실패 `error`+`error_message`, 사용자 개입 필요 `blocked`+`blocked_reason`.
7. **`.codex` TDD 가드** — `lib/`·`services/`·`app/api` **로직 소스는 대응 테스트가 없으면 편집 차단**. 이런 step은 "테스트 먼저" 지시를 넣어라. `components/`·`types/`·설정/스타일은 예외.
8. **하네스 실행 모델** — phase 폴더 1개 = 브랜치 `feat-{phase}` 1개, step 순차 실행(codex exec, 30분/step·재시도 3회), 완료 step `summary`가 다음 step에 누적. phase는 **순서대로** 실행하면 앞 phase 코드 위에 쌓인다.
9. **`index.json` 스키마** — `{ "project": "FreeSign", "phase": "<dir>", "steps": [{ "step": N, "name": "<kebab>", "status": "pending" }] }`. 타임스탬프·created_at은 넣지 마라(execute.py가 기록).

step 크기 기준: **하나의 step = 하나의 레이어/모듈**, 30분 내 완료 가능하게. 크면 쪼개라.

---

## 미결 결정 (phase 1 작성 전 확정 필요)

- **Supabase 실행 모드** — DB phase 자율 실행 방식:
  - (A) **로컬 Supabase CLI(docker)** — `supabase start`+`db reset`+`gen types`가 외부 인증 없이 로컬에서 돌아 마이그레이션·타입생성·RLS 테스트 자율 실행. 클라우드 키는 배포 시에만. (docker 필요)
  - (B) **클라우드 Supabase** — DB phase가 키/프로젝트 대기로 `blocked` 처리(수동 개입).
  - (C) **수동 SQL + 타입 수동작성** — 라이브 DB 없이 진행, RLS 실검증 불가.
  - → phase 1 step의 AC(마이그레이션 적용·`gen types`·RLS 테스트 실행 여부)가 이 선택에 따라 달라진다.
- **PLAN.md** — CLAUDE.md·AGENTS.md·SCENARIO가 `PLAN.md`를 참조하나 파일 없음(가드레일 로더는 `docs/*.md`만 주입하므로 실행엔 무해). (A) phase 1 step으로 생성 / (B) 참조를 `docs/`로 수정 / (C) 그대로 둠.

---

## Phase 1: `1-database` — 데이터 레이어

**목적**: Postgres 스키마·RLS·인덱스·트리거·생성 타입·공용 쿼리 헬퍼·데모 시드. 방어 코어("기록 체인")의 토대.
**선행**: phase 0(supabase 클라이언트·env·types 스텁).
**1차 스펙**: `docs/ARCHITECTURE.md` "데이터 모델" 전체 + "데이터 모델 규칙", `docs/ADR.md` ADR-002·ADR-006·ADR-008.

| step | name | 스코프 |
|---|---|---|
| 0 | `schema-migrations` | 6테이블(clients·contracts·invoices·contract_events·invoice_events·profiles) 마이그레이션. 컬럼·enum·CHECK 제약(`amount>0`, `0≤withholding≤amount`, `net≥0`, `due≥issue`)·FK `ON DELETE RESTRICT`·공통 컬럼(`is_demo`·`deleted_at`·`updated_at`)·`updated_at` 트리거 |
| 1 | `rls-policies` | 전 테이블 RLS enable + **`USING` + `WITH CHECK (user_id = (select auth.uid()))` 둘 다**. 이벤트 테이블은 **select/insert만**(UPDATE/DELETE 정책 없음 = append-only). **TDD: 타 user_id 행 read/insert 차단을 검증하는 RLS 경계 테스트** |
| 2 | `indexes` | 부분 인덱스: `(user_id) WHERE deleted_at IS NULL`, `(user_id, due_date) WHERE payment_status='unpaid'`, `(user_id, client_id)`, 이벤트 `(contract_id/invoice_id, created_at)` |
| 3 | `generated-types` | `supabase gen types`로 `src/types/database.ts` **스텁 교체**(phase 0 스텁 덮어씀) |
| 4 | `query-helpers` | 공용 쿼리 헬퍼(`lib/db/`): **`deleted_at IS NULL` 필터는 RLS가 아니라 여기서**. 소유권 재조회 헬퍼(FK insert 전 검증용). **TDD** |
| 5 | `demo-seed` | CLI 시드 스크립트(`service_role`, **CLI 전용·요청 경로 금지**). SCENARIO의 샘플(무디 등) `is_demo=true`로 삽입 |

**핵심 제약(박아라)**: RLS `WITH CHECK` 누락 시 타 user 삽입·소유권 이관 가능 → 둘 다 필수. `deleted_at` 필터를 RLS에 넣지 마라(soft-delete 행이 복원·감사·CSV에서 사라짐). `service_role`은 CLI 시드에서만.

---

## Phase 2: `2-domain-logic` — 순수 함수 + 서비스 어댑터

**목적**: 계산·변환 순수 함수와 v1 Provider 어댑터. **TDD 집중 phase.**
**선행**: phase 1(types). **1차 스펙**: `docs/ADR.md` ADR-003·ADR-004, `docs/ARCHITECTURE.md`(원천징수 계산·집계 규칙).

| step | name | 스코프 |
|---|---|---|
| 0 | `tax` | `lib/tax.ts` 원천징수 계산: 소득세(원 미만 절사) + 지방소득세(10원 미만 절사) 분리, `wt_3_3`/`wt_8_8`/`none`. **TDD 필수**(경계값·절사) |
| 1 | `metrics` | `lib/metrics.ts` 대시보드 집계 **변환/포맷만**(집계 SUM/GROUP BY는 SQL). KST 기준·통화 포맷. **TDD** |
| 2 | `ai-draft` | `services/ai/` Claude tool-use/JSON, zod 검증(`{title,body,plain_summary,needs_review}`), **템플릿 골격 폴백**(실패·타임아웃 시), 멱등 재시도. **AI는 필수 게이트 아닌 보강** |
| 3 | `signature-provider` | `services/signature/` `SignatureProvider` 인터페이스(v1 캔버스+해시). `doc_hash` = canonical clauses JSON SHA-256 |
| 4 | `payment-provider` | `services/payment/` `PaymentProvider` 인터페이스(v1 수동 상태) |

**핵심 제약**: 서명·결제는 **Provider 인터페이스 뒤로만**(v2 교체 지점). AI 결과는 항상 "초안"·면책, 실패해도 기능 안 막힘(골격 폴백). 원천징수는 발행 시점 스냅샷용 계산(drift 방지).

---

## Phase 3: `3-auth` — 인증·보호 경계

**목적**: Google OAuth·세션 가드·dev 테스트 로그인. **여기서 처음 `getUser()` 보호가 (dashboard)에 붙는다.**
**선행**: phase 0(supabase·middleware·app-shell), phase 1(profiles). **1차 스펙**: `docs/ADR.md` ADR-001·ADR-007, `docs/ARCHITECTURE.md`(인가 `getUser()`, middleware는 보안 경계 아님).

| step | name | 스코프 |
|---|---|---|
| 0 | `oauth-login` | `app/(auth)/login` 페이지 + Google OAuth 시작 + 콜백 route handler(code 교환) |
| 1 | `session-guard` | `(dashboard)/layout.tsx`에 **`getUser()` 가드 + 미인증 시 `/login` 리다이렉트**(phase 0에서 비워둔 자리). 루트 `/` 리다이렉트 정리 |
| 2 | `dev-test-login` | E2E용 dev 전용 테스트 로그인 경로. **이중 가드**(빌드 타임 제외 + `NODE_ENV!=='production'`), 프로덕션 빌드 시 404 |

**핵심 제약**: 인가는 **`getUser()`**(`getSession()` 아님). middleware는 토큰 갱신 전용. dev 테스트 로그인은 백도어 리스크 → 이중 가드 필수.

---

## Phase 4: `4-clients` — 클라이언트 기능(가장 단순한 수직 슬라이스 = 패턴 정립)

**목적**: 첫 CRUD 수직 슬라이스. 이후 계약·인보이스가 따를 **읽기(RSC)/쓰기(Server Action) 패턴의 레퍼런스**.
**선행**: phase 1~3. **1차 스펙**: `docs/ARCHITECTURE.md`(읽기/쓰기 패턴·데이터 흐름), `docs/UI_GUIDE.md`(테이블·폼·채널 배지), `docs/UX_PRINCIPLES.md`.

| step | name | 스코프 |
|---|---|---|
| 0 | `client-read` | `/clients` 목록 + `/clients/[id]` 상세 **RSC 직접 조회**(쿼리 헬퍼), 채널 태그 배지·필터 |
| 1 | `client-actions` | Server Actions 생성·수정·soft-delete. **client 입력 전용 zod allowlist(도메인 필드만)**, `user_id`는 `getUser()`에서, `revalidatePath` |
| 2 | `client-form` | react-hook-form + zod 폼 UI(동일 스키마 서버 재검증), 채널 select |

**핵심 제약**: 읽기를 내부 `/api` fetch로 우회 금지. Server Action은 `user_id`·서버 소유 필드를 client 입력으로 받지 마라. clients는 이벤트 로그 없음(도메인 3테이블 중 이벤트는 contract/invoice만).

---

## Phase 5: `5-contracts` — 계약(가장 큰 phase: AI·서명·PDF·상태전이)

**목적**: AI 초안 플로우 + 캔버스 서명 + 계약 PDF + status 상태머신. **PDF 인프라가 여기서 처음 도입된다.**
**선행**: phase 2(ai·signature 서비스), phase 4(패턴). **1차 스펙**: `docs/PRD.md`(기능2·3), `docs/ARCHITECTURE.md`(서명 순서·상태전이 머신·AI 초안 흐름), `docs/ADR.md` ADR-004·ADR-005, `docs/UI_GUIDE.md`(스텝 인디케이터·면책 배너·이력 타임라인), `SCENARIO.md` ③④.

| step | name | 스코프 |
|---|---|---|
| 0 | `contract-read` | `/contracts` 목록 + `/contracts/[id]` 상세(조항+평문요약 카드·상태 배지·이력 타임라인) RSC |
| 1 | `contract-create-ai` | `/contracts/new` 구조화 입력 → `services/ai` 초안 생성 → draft 저장. **스텝 인디케이터(점진적 노출)·면책 배너·실패 시 골격 폴백** |
| 2 | `contract-edit-confirm` | 조항 편집 → 확정. `clauses` jsonb zod 검증(`needs_review`) |
| 3 | `contract-status` | status 전이(draft→signed→active→done, canceled). **도메인 UPDATE 후 `contract_events` INSERT 순차**(status 변경을 앞쪽에 두지 마라) |
| 4 | `signature` | 캔버스 서명(client) → Server Action/route: **Storage 업로드(private `{user_id}/{contract_id}/`) → `doc_hash`+IP/UA 메타(서버) → status=signed → 이벤트 순.** 업로드/해시를 status 앞에(부분 실패 시 미완 방지) |
| 5 | `contract-pdf` | `@react-pdf/renderer` route `runtime='nodejs'`. **`next.config` `outputFileTracingIncludes`(폰트/wasm)+`maxDuration`**, Pretendard TTF **한글 전영역 임베드**. Storage는 key만 저장·읽기는 단기 signed URL |

**핵심 제약**: 서명 후 조항 read-only(편집하려면 draft로 되돌려 `signature_meta` 초기화·재서명). IP/UA는 서버 라우트에서만 기록. AI 면책 반복 노출. **PDF는 Node 런타임 전용**(Edge 불가). 서버 소유 필드(`doc_hash`·`signature_meta`·pdf 경로·status) client 입력 금지.

---

## Phase 6: `6-invoices` — 인보이스·정산

**목적**: 인보이스 CRUD + 원천징수 스냅샷 + 정산 토글 + 인보이스 PDF.
**선행**: phase 2(tax), phase 5(PDF 인프라). **1차 스펙**: `docs/ARCHITECTURE.md`(invoices 모델·상태전이·스냅샷), `docs/UI_GUIDE.md`(원천징수 점진적 노출), `SCENARIO.md` ⑤⑥.

| step | name | 스코프 |
|---|---|---|
| 0 | `invoice-read` | `/invoices` 목록(상태 필터) + `/invoices/[id]` 상세(원천징수 내역·계좌) RSC |
| 1 | `invoice-create` | 계약 아래 발행(계약 1:N). **FK(contract/client) 소유권 재조회 검증 후 insert**. `lib/tax` **발행 시점 스냅샷**(withholding·net·amount 고정), 서버 소유 필드 client 입력 금지 |
| 2 | `payment-toggle` | `payment_status` 토글(unpaid↔paid, 되돌리기 허용). `paid_at`/`method` 서버 기록. **`useOptimistic`(실패 시 롤백+토스트) + 이벤트 로그**. overdue는 상태 아님(파생) |
| 3 | `invoice-pdf` | phase 5 PDF 인프라 재사용, 인보이스 PDF(한글 임베드) |

**핵심 제약**: 원천징수·금액은 발행 후 고정 스냅샷(draft 동안만 재계산). FK는 RLS 우회하므로 Server Action에서 소유권 재검증 필수. 상태전이는 이벤트 append.

---

## Phase 7: `7-dashboard-reports` — 대시보드·리포트·데모

**목적**: "내 돈이 어디까지 왔나" KPI + 채널 리포트/CSV + 데모 채우기/지우기.
**선행**: phase 1~6. **1차 스펙**: `docs/ARCHITECTURE.md`(집계 규칙·KST), `docs/UX_PRINCIPLES.md`(계층·3초 판독), `docs/UI_GUIDE.md`(KPI 카드·빈 상태), `SCENARIO.md` ①⑦⑧.

| step | name | 스코프 |
|---|---|---|
| 0 | `dashboard` | KPI(미수금 합계·이달 수익) **SQL 집계**(`date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul')`) + `lib/metrics` 변환, 임박/지연(파생) 리스트, 채널 수익 TOP 위젯 |
| 1 | `reports-csv` | `/reports` 채널별 수익 + 연도 필터 + **CSV 내보내기(서버 route)**. 기준(paid_at/issue_date) 명시 |
| 2 | `demo-data` | 데모 채우기/지우기 Server Actions. **지우기는 demo 이벤트 선삭제 → demo 도메인 행 삭제**(FK RESTRICT 순서). **`is_demo=true`만 하드삭제**(실데이터 paid 인보이스 하드삭제 금지) |

**핵심 제약**: 집계는 SQL(별도 집계 테이블 없음), JS는 변환만. "이달 수익"은 KST 기준(UTC를 JS로 집계하면 9시간 밀림). CSV·집계는 서버 전용.

---

## Phase 8: `8-e2e` — E2E·CI·상태 점검

**목적**: 실사용 플로우 자동 검증 + CI + 모든 상태(로딩·빈·에러) 점검.
**선행**: phase 0~7. **1차 스펙**: `docs/ADR.md` ADR-007, `docs/UX_PRINCIPLES.md`(상태·피드백 원칙).

| step | name | 스코프 |
|---|---|---|
| 0 | `playwright-setup` | Playwright 설정 + dev 테스트 로그인(phase 3) 연동 |
| 1 | `e2e-flows` | 로그인~클라이언트~계약~서명~인보이스~정산~대시보드~CSV 해피패스(SCENARIO 여정) |
| 2 | `ci` | GitHub Actions CI(lint·build·test·e2e). OAuth E2E는 dev 테스트 로그인으로 대체 |
| 3 | `state-audit` | 전 화면 로딩(`loading.tsx`)·빈 상태·에러(`error.tsx`)·성공 토스트 존재 점검·보강 |

**핵심 제약**: AC를 실행 가능한 커맨드로. OAuth 실플로우는 dev 테스트 로그인 경로로 대체(백도어 이중 가드 유지).

---

## 진행 현황 추적

- 현재 상세 작성 완료: **phase 0(`0-foundation/`)** — step 0~4.
- phase 1~8: 이 문서 기준으로 `index.json` + `stepN.md`를 **실행 직전 just-in-time으로** 작성.
- 새 phase를 작성할 때: ① phase 0 step 파일들을 형식 레퍼런스로 열고 → ② 이 문서의 해당 phase 표·핵심 제약을 반영 → ③ **직전 phase가 완료된 뒤 실제 생성된 파일 경로를 "읽어야 할 파일"에 넣어라**(설계 시점 예상 경로가 아니라 실제 산출물).

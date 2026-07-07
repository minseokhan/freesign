# Step 0: invoice-read

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. 라우트 표(`/invoices` 목록, `/invoices/[id]` 상세), invoices 모델(컬럼·`payment_status` enum: `draft|unpaid|paid`·`amount`·`withholding_type`·`withholding_amount`·`net_amount`·`issue_date`·`due_date`·`paid_at`·FK `contract_id`/`client_id`), 읽기는 RSC 직접 조회 규칙, KST 기준 표기.
- `/docs/UI_GUIDE.md` — 상태 배지(pill, 전 화면 동일)·테이블(목록)·**원천징수 점진적 노출**(요약은 net, 상세에서 income/local/withholding 펼침)·계좌 정보 표기.
- `/docs/UX_PRINCIPLES.md` — 계층·3초 판독·빈 상태.
- `/CLAUDE.md` — CRITICAL: 읽기는 RSC 직접 조회(내부 `/api` fetch 금지). `deleted_at IS NULL`은 공용 헬퍼(`notDeleted`)에서. 집계는 SQL·JS는 변환만.
- 이전 phase 산출물(실제 경로 — 그대로 패턴 재사용):
  - `src/app/(dashboard)/invoices/page.tsx` — 현재 **플레이스홀더**. 실제 목록으로 교체.
  - **읽기 패턴 레퍼런스**(그대로 따라라): `src/app/(dashboard)/contracts/page.tsx`(RSC 목록+`notDeleted`+상태 필터+배지), `src/app/(dashboard)/contracts/[id]/page.tsx`(단건 조회+`notFound()`+이력 타임라인), `src/app/(dashboard)/clients/page.tsx`.
  - **배지 컴포넌트 패턴**: `src/components/contract-status-badge.tsx`(enum→한국어 라벨+색 매핑, 순수 표시 상수 co-locate). `src/components/channel-badge.tsx`.
  - `src/lib/db/index.ts` — `notDeleted(query)`(조회 필수).
  - `src/lib/supabase/server.ts` — `createClient()`(RLS 스코프 서버 클라이언트).
  - `src/lib/tax.ts` — `calcWithholding`·`WithholdingBreakdown`(표시용 원천징수 내역 참고. **재계산 금지** — 저장된 스냅샷 컬럼을 그대로 읽어라).
  - `src/types/database.ts` — `invoices`·`invoice_events` Row 타입, `payment_status`/`withholding_type` enum.
  - `src/components/ui/{card,badge,button}.tsx` — 프리미티브.

**배경**: 이 step은 **인보이스 수직 슬라이스의 "읽기"**다. phase 4~5에서 정립한 **RSC 직접 조회 패턴을 그대로 재사용**한다. 인보이스는 계약(contract) 아래 발행되며 원천징수 스냅샷·정산 상태를 가진다. **읽기 전용** — 발행·정산 토글·PDF는 step 1~3 소관, 이 step은 **표시만** 한다.

## 작업

### 1) 목록 — `src/app/(dashboard)/invoices/page.tsx` 교체

- **RSC에서 Supabase 직접 조회**(`.from("invoices")`에 `notDeleted(...)`). 계약·클라이언트명을 함께 보이려면 FK 조인 select(예: `contract:contracts(title)`, `client:clients(name)`). 정렬 `issue_date desc`(또는 `created_at desc`) 재량.
- 목록 UI: UI_GUIDE 테이블 규격 — 클라이언트/계약·금액(`amount`, tabular-nums 우측 정렬)·**정산 상태 배지**·발행일·지급기한. **상태 필터**(선택, `searchParams`: `draft|unpaid|paid`).
- **정산 상태 배지 컴포넌트**: `payment_status`(3값) → 한국어 라벨 + 색 매핑. `contract-status-badge.tsx` 패턴을 따라 `src/components/payment-status-badge.tsx`로 만든다. 순수 표시 상수는 컴포넌트에 co-locate(TDD 가드 예외).
- **`overdue`(연체)는 저장 상태가 아니라 파생**이다: `payment_status === 'unpaid' && due_date < 오늘(KST)`. 배지/표시에서 파생으로 계산해 강조하되, **DB 컬럼으로 만들지 마라**.
- **빈 상태**: 인보이스 0건 시 빈 상태 + 안내(발행 진입점은 계약 상세, 실제 생성은 step 1 — 여기서는 링크 자리).

### 2) 상세 — `src/app/(dashboard)/invoices/[id]/page.tsx` 신규

- **RSC 직접 조회**. `params.id`로 단건(`notDeleted`, `maybeSingle()`), 없으면 `notFound()`.
- 표시 영역(UI_GUIDE):
  - **금액·원천징수 내역 카드**: 저장된 스냅샷(`amount`·`withholding_type`·`withholding_amount`·`net_amount`)을 그대로 표시. **원천징수 점진적 노출** — 기본은 실수령액(`net_amount`) 중심, 펼치면 원천징수액 내역. **여기서 `calcWithholding`로 재계산하지 마라**(발행 스냅샷이 진실. 재계산은 drift 위험).
  - **계좌 정보**: 입금 계좌(`profiles`의 `bank_name`/`bank_account_number`/`bank_account_holder`)를 조회해 표시(있을 때).
  - **정산 상태 배지** + 발행일·지급기한·`paid_at`(입금일, 있으면).
  - **이력 타임라인**: `invoice_events`를 `created_at` 순으로 조회해 상태 이력 타임라인으로(이벤트는 append-only — 읽기만).
  - 정산 토글 버튼·PDF 버튼은 **자리만**(실제 동작은 step 2·3). 비활성 또는 placeholder.

## Acceptance Criteria

```bash
npm run lint
npm run build     # /invoices 목록·[id] 상세 RSC가 컴파일
npm test          # 기존 테스트 green (+ lib에 순수 매핑/파생 로직을 넣었다면 그 테스트)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 목록·상세가 **RSC 직접 조회**인가(내부 `/api` fetch 없음)?
   - 조회에 **`notDeleted`**를 적용했는가?
   - 정산 상태가 **배지(색+텍스트 라벨)**로 표시되는가? `overdue`는 **파생**으로 계산했는가(컬럼 아님)?
   - 원천징수 내역이 **저장 스냅샷을 그대로** 표시하는가(재계산 없음)?
   - 없는 id는 `notFound()`인가?
   - (dashboard) 레이아웃 가드가 덮으므로 page에 `requireUser()` 중복이 없는가?
3. `phases/6-invoices/index.json`의 step 0을 업데이트(성공 `completed`+`summary` / 3회 실패 `error`+`error_message` / 개입 필요 `blocked`+`blocked_reason`).

## 금지사항

- 읽기를 내부 `/api`로 우회하지 마라. 이유: CRITICAL — 읽기는 RSC 직접 조회.
- 원천징수를 `calcWithholding`로 **재계산**해 표시하지 마라. 이유: 발행 시점 스냅샷(`withholding_amount`·`net_amount`)이 진실. 재계산은 세율 변경 시 과거 인보이스와 drift.
- `overdue`를 DB 컬럼/상태로 만들지 마라. 이유: 연체는 `due_date`+`payment_status`에서 파생되는 값(ROADMAP 핵심 제약).
- Server Action·발행·정산 토글·PDF 로직을 만들지 마라. 이유: 각각 step 1~3 소관. 이 step은 읽기 전용 — 스코프 크립 금지.
- `invoice_events`에 INSERT 하지 마라. 이유: 이벤트 생성은 발행(step 1)·정산 토글(step 2) 소관. 여기서는 read-only.
- 기존 테스트를 깨뜨리지 마라.

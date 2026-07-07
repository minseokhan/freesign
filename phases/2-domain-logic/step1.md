# Step 1: metrics

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "데이터 모델 규칙"의 **집계**(대시보드·리포트 지표는 **SQL 집계**(`SUM`/`GROUP BY`) + `lib/metrics.ts` 순수 변환/포맷, 별도 집계 테이블 없음, "이달 수익"은 SQL `date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul')`), "상태 전이 머신"(overdue는 저장 상태가 아니라 **파생**)
- `/docs/UX_PRINCIPLES.md` — 3초 판독·계층(대시보드가 이 변환 결과를 읽는다)
- `/docs/UI_GUIDE.md` — KPI 카드·채널 수익 TOP 위젯·임박/지연 리스트(이 함수들이 공급하는 표시 데이터 형태)
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: 집계는 SQL, **변환만 JS**. 순수 함수 TDD.
- phase 1 산출물: `src/types/database.ts` — `invoices`(`amount`/`net_amount`/`due_date`/`paid_at`/`payment_status`) 컬럼 shape(이미 SQL로 집계된 행/스칼라가 이 함수의 입력)
- phase 2 step 0 산출물: `src/lib/tax.ts`(원천징수 금액의 계산 소스 — metrics는 그 결과를 표시 변환할 뿐 재계산 금지)

**배경**: 대시보드·리포트 phase(7)는 KPI를 **SQL로 집계**한다(미수금 합계·이달 수익·채널별 SUM). `lib/metrics.ts`는 그 **이미 집계된 값**을 화면용으로 변환/포맷하고, 저장되지 않는 **파생 상태**(임박/지연)를 계산하는 순수 함수 모음이다. 이 step은 그 변환 함수만 만든다. SQL 쿼리·페이지·위젯은 phase 7 소관이다.

## 작업

`src/lib/metrics.ts` 순수 변환/포맷 함수를 만든다. **`lib/` 로직이므로 TDD 대상 — 테스트를 먼저 작성**하라(`src/lib/__tests__/metrics.test.ts`).

### 경계(반드시 지켜라)

- 이 모듈은 **집계(SUM/COUNT/GROUP BY)를 하지 마라**. 그건 SQL이 한다(ARCHITECTURE·ADR: 별도 집계 테이블 없음, DB에서 집계). metrics는 (a) 표시 포맷, (b) 파생 상태 계산, (c) 이미 집계된 배열의 정렬/상위 N 절단 같은 **변환**만 한다.
- 모든 함수는 **순수**하다. "오늘/지금"이 필요하면 `now` 인자로 **주입**받아라. 함수 안에서 `new Date()`/`Date.now()`를 호출하지 마라 — 재현·테스트 불가해진다(그리고 프로젝트 하네스에서 `Date.now()`는 금지).

### 시그니처(예시 — 정확한 형태·집합은 재량, 아래 3범주를 커버하면 된다)

**1) 통화·표시 포맷**
```ts
export function formatKRW(amount: number): string;   // 예: 1000000 → "₩1,000,000" 또는 "1,000,000원"
```
UI_GUIDE의 표기 관례를 따르되, 한 가지로 일관되게. 정수 원만 다룬다(소수 없음).

**2) 파생 due 상태(저장 안 됨)**
```ts
export type DueStatus = "overdue" | "due_soon" | "upcoming" | "paid";
// unpaid 인보이스의 due_date를 KST 기준 today와 비교해 파생.
// paid면 무조건 "paid". overdue = due_date < today. due_soon = today <= due_date <= today+N일.
export function deriveDueStatus(
  input: { dueDate: string; paymentStatus: "unpaid" | "paid" | "draft"; },
  now: Date,
): DueStatus;
```
- **KST 기준으로 날짜 경계를 비교**하라(UTC로 비교하면 자정 근처가 9시간 밀린다). "임박" 임계일 수(N)는 상수로 두고 근거를 주석에.
- overdue는 **파생**이지 저장 상태가 아니다(payment_status enum에 overdue 없음). 절대 저장 상태로 취급하지 마라.

**3) 이미 집계된 결과의 변환**
```ts
// SQL이 채널별 SUM(net_amount)을 계산해 넘긴 배열을 금액 내림차순 정렬 + 상위 N 절단.
export function topChannelsByRevenue(
  rows: { channel: string; revenue: number }[],
  limit: number,
): { channel: string; revenue: number }[];
```
여기서 **revenue를 다시 합산하지 마라**(SQL이 이미 SUM함). 정렬·절단만.

정확히 어떤 함수가 phase 7에 필요한지는 phase 7에서 확정된다. 이 step은 위 3범주를 대표하는 최소 함수 집합을 순수·테스트 가능하게 제공하면 충분하다. 추측성 함수를 남발하지 마라(CLAUDE.md 단순함 우선).

### 테스트 (먼저 작성)

- `formatKRW`: 천단위 구분·0·큰 수. (음수 정책이 필요하면 정하고 테스트)
- `deriveDueStatus`: paid → "paid"(due_date 무관), due_date가 today보다 과거 → "overdue", 임박 창 안 → "due_soon", 먼 미래 → "upcoming". **KST 자정 경계**를 노리는 케이스(예: UTC로는 어제/오늘이 갈리는 시각의 `now`)를 최소 1개.
- `topChannelsByRevenue`: 내림차순 정렬·limit 절단·동률 처리. 입력 배열을 변형(mutate)하지 않는지.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test    # metrics 단위테스트(테스트 먼저) + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 집계(SUM/GROUP BY)를 JS로 하지 않는가(변환·포맷·정렬만)?
   - `now`가 인자로 주입되는가(내부 `new Date()`/`Date.now()` 호출 없음)?
   - due 상태 비교가 **KST 기준**인가(UTC 밀림 없음)?
   - overdue를 파생으로만 다루는가(저장 상태 아님)?
   - 테스트가 먼저 작성됐는가(TDD)?
3. `phases/2-domain-logic/index.json`의 step 1을 업데이트(성공 `completed`+summary / 3회 실패 `error` / 개입 필요 `blocked`).

## 금지사항

- SQL 집계를 JS로 재구현하지 마라(전체 인보이스를 받아 합산 등). 이유: ARCHITECTURE — 집계는 DB, JS는 변환만. UTC 저장을 JS로 월 집계하면 KST 9시간 밀린다.
- 함수 안에서 `new Date()`/`Date.now()`를 부르지 마라. 이유: 순수성·재현성 상실, 하네스에서 금지. `now`를 주입하라.
- 대시보드/리포트 페이지·SQL 쿼리·위젯을 만들지 마라. 이유: phase 7 소관.
- 원천징수 금액을 재계산하지 마라. 이유: 계산 소스는 `lib/tax.ts`(step 0)·발행 스냅샷. metrics는 표시 변환만.
- phase 7이 쓸지 불확실한 함수를 추측으로 대량 추가하지 마라. 이유: CLAUDE.md 단순함 우선 — 필요 시 phase 7에서 추가한다.
- 기존 테스트를 깨뜨리지 마라.

# Step 0: dashboard

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. 집계 규칙(**SUM/GROUP BY는 SQL**, JS는 변환만)·**KST 기준**(`date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul')`)·읽기는 RSC 직접 조회. `overdue`/임박은 파생.
- `/docs/UX_PRINCIPLES.md` — 계층·**3초 판독**·시각적 위계. `/docs/UI_GUIDE.md` — KPI 카드·빈 상태·채널 배지·통화 표기.
- `/CLAUDE.md` — CRITICAL: **집계는 SQL, 변환만 JS**(`lib/metrics.ts`). 읽기는 RSC 직접 조회(내부 `/api` fetch 금지). 서버 인가는 `getUser()`. "이달 수익"은 **KST 기준**(UTC를 JS로 집계하면 9시간 밀림).
- 이전 phase 산출물(실제 경로 — 그대로 재사용):
  - `src/app/(dashboard)/dashboard/page.tsx` — 현재 **플레이스홀더**(비활성 "데모 데이터 채우기" 버튼 포함). 실제 대시보드로 교체. **데모 버튼은 자리만**(실제 동작은 step 2).
  - `src/lib/metrics.ts` — **변환/포맷 순수 함수(그대로 사용, 집계 로직을 여기 넣지 마라)**: `formatKRW(amount)`, `deriveDueStatus({ dueDate, paymentStatus }, now): "overdue"|"due_soon"|"upcoming"|"paid"`, `topChannelsByRevenue(rows, limit)`, `ChannelRevenueRow { channel, revenue }`. 임박/지연 분류·통화 포맷·TOP 정렬은 이걸로.
  - `src/lib/metrics.test.ts`가 아니라 `src/lib/__tests__/metrics.test.ts` — 기존 metrics 테스트(깨뜨리지 마라. 새 변환 추가 시 여기 테스트 추가).
  - `supabase/migrations/0001_schema.sql`~`0004_storage.sql` — 마이그레이션 관례(번호·순수 SQL). **집계 함수는 여기 규칙을 따라 새 파일로.**
  - **pg 테스트 하네스**(SQL 검증 방식 레퍼런스): `src/test/__tests__/`(예: `schema.test.ts`·`rls.test.ts`·`pg.test.ts`) — 로컬 pg에 마이그레이션 적용 후 SQL을 검증하는 패턴.
  - `src/lib/supabase/server.ts` — `createClient()`(RLS 스코프·`.rpc()` 호출). `src/lib/db/index.ts` — `notDeleted`.
  - `src/types/database.ts` — `invoices`(`amount`·`net_amount`·`payment_status`·`paid_at`·`due_date`)·`clients`(`channel`)·enum. **`.rpc()` 함수는 gen 타입에 없을 수 있음** → 반환 타입을 명시(`as`)하거나 `Database` 재생성은 하지 말고 좁은 타입으로 캐스팅.
  - `src/components/channel-badge.tsx` — 채널 라벨/색. `src/components/ui/{card,button,badge}.tsx` — 프리미티브.

**배경**: 이 step은 **"내 돈이 어디까지 왔나"를 3초에 읽는 대시보드**다. 핵심 KPI(미수금 합계·이달 수익)와 임박/지연 인보이스 리스트, 채널 수익 TOP 위젯을 보여준다. **집계(SUM/GROUP BY)는 SQL에서**, JS(`lib/metrics.ts`)는 **분류·정렬·포맷 변환만** 한다.

## 작업

### 1) SQL 집계 함수 — `supabase/migrations/0005_dashboard_metrics.sql` 신규

- **집계는 SQL에서** 수행한다(CLAUDE.md). 대시보드가 필요로 하는 집계를 **`security invoker`(호출자 RLS 적용) Postgres 함수**로 만들고 앱에서 `supabase.rpc('...')`로 호출한다. 최소:
  - **미수금 합계**: `payment_status = 'unpaid'`(soft-delete 제외)의 `SUM(amount)`(또는 정책상 `net_amount` — ARCHITECTURE 정의를 따르되 한 기준으로 고정).
  - **이달 수익**: `payment_status = 'paid'` 이고 `date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul') = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')`의 `SUM(net_amount)`. **KST 필수**.
  - **채널별 수익**: `paid` 인보이스를 `clients.channel`로 `GROUP BY`한 `SUM(net_amount)`(리스트 반환 → JS에서 `topChannelsByRevenue`로 TOP N).
- **`security invoker` + `deleted_at IS NULL` 필터**를 함수 안에 넣어라(RLS는 함수 호출자 기준으로 적용되지만 soft-delete 제외는 쿼리에서). `search_path`를 안전하게 고정(`set search_path = public`).
- **pg 테스트 하네스에 검증 테스트 추가**: 마이그레이션 적용 후 함수가 올바른 합계/그룹을 반환하는지(특히 **KST 월 경계**·soft-delete 제외·unpaid/paid 구분) `src/test/__tests__/`에 테스트 추가. 레퍼런스: 기존 `schema.test.ts`.

### 2) 대시보드 페이지 — `src/app/(dashboard)/dashboard/page.tsx` 교체

- **RSC에서 직접 조회**. KPI는 위 `.rpc()` 집계 결과를 받아 `formatKRW`로 포맷. **JS에서 SUM 하지 마라.**
- **임박/지연 리스트**: `unpaid` 인보이스를 조회(`notDeleted`)해 **`deriveDueStatus(..., now)`로 분류**(overdue·due_soon). 이건 per-row 분류(집계 아님)라 JS 변환 OK. 지연·임박을 강조 표시.
- **채널 수익 TOP 위젯**: 채널별 수익 rpc 결과 → `topChannelsByRevenue(rows, N)` → `channel-badge`로 표시.
- **빈 상태**: 데이터 0일 때 기존 빈 상태 유지/개선. "데모 데이터 채우기" 버튼은 **자리만**(실제 동작은 step 2 — 여기서 Server Action 만들지 마라).
- 시각 위계: UX_PRINCIPLES(3초 판독) — 미수금·이달 수익을 최상단 큰 KPI 카드로.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test          # 집계 함수 pg 테스트 + metrics 변환 테스트 통과, 기존 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - KPI **집계가 SQL(`.rpc()`)**에서 오는가? JS로 SUM/GROUP BY 하지 않았는가?
   - "이달 수익"이 **KST(`AT TIME ZONE 'Asia/Seoul'`)** 기준인가?
   - 집계 함수가 **`security invoker`**이고 `deleted_at IS NULL`을 제외하는가?
   - 임박/지연이 **`deriveDueStatus` 파생**인가(저장 상태 아님)?
   - 대시보드가 **RSC 직접 조회**인가(내부 `/api` fetch 없음)?
   - 데모 채우기 버튼은 **자리만**인가(Server Action 미구현)?
3. `phases/7-dashboard-reports/index.json`의 step 0을 업데이트(성공/실패/blocked). 라이브 DB/pg 하네스가 없어 집계 함수 검증이 불가면 `blocked`+사유.

## 금지사항

- SUM/GROUP BY를 JS에서 하지 마라. 이유: CRITICAL — 집계는 SQL, JS는 변환만(`lib/metrics.ts`).
- "이달 수익"을 UTC로 집계하거나 JS에서 월을 계산하지 마라. 이유: KST와 9시간 밀려 월 경계 오류.
- 대시보드 읽기를 내부 `/api` fetch로 우회하지 마라. 이유: CRITICAL — 읽기는 RSC 직접 조회.
- `overdue`/임박을 DB 컬럼/상태로 만들지 마라. 이유: 파생 값(`deriveDueStatus`).
- 데모 채우기/지우기 Server Action을 만들지 마라. 이유: step 2 소관.
- CSV·리포트 페이지를 만들지 마라. 이유: step 1 소관.
- 별도 집계 테이블을 만들지 마라. 이유: ARCHITECTURE — 집계 테이블 없이 SQL 집계.
- 기존 테스트를 깨뜨리지 마라.

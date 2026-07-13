# 대시보드 개선 계획

> ✅ **구현 완료(아카이브).** 이 계획의 모든 항목이 반영됐다 — 예정 입금·계약 파이프라인·건수 배지 모두 라이브. 실제 집계는 `supabase/migrations/0011_dashboard_additions.sql`(아래 §3의 계획상 `0006`이 아니라 실제로는 0011로 생성됨), 순수 함수는 `src/lib/metrics.ts`의 `summarizeContractPipeline`, UI는 `src/app/(dashboard)/dashboard/page.tsx`. 현재 스키마·함수는 `docs/DATABASE.md` 참조. 아래 본문은 당시 계획 기록이다.

## 0. 완료된 것 (이번 세션)
- `임박/지연 지급기한` 카드 좌/상 이중 여백 버그 수정.
  - 원인: `cn`의 tailwind-merge가 커스텀 여백 토큰(`p-xl`)을 인식하지 못해 `p-0`이 `Card` 기본 패딩을 못 지움 → 카드 24px + 헤더 24px = 좌 48px·상 40px.
  - 조치: `dashboard/page.tsx`에서 해당 카드만 `!p-0`로 강제(다른 화면 무영향). 좌측 여백이 다른 카드와 동일한 24px로 정렬됨.
  - 참고(미조치): clients/invoices/contracts/reports 테이블 6곳도 동일 `p-0` 버그로 24px 인셋이 남아 있음. 이번 범위 밖(요청 시 근본 원인 `cn` 한 줄 수정으로 일괄 해결 가능).

## 1. 추가할 정보 (사용자 선택)
1. **이번 달 예정 입금** — 다가오는 현금흐름
2. **계약 파이프라인 요약** — 청구 이전 단계 가시성
3. **건수 배지** — 기존 금액 카드에 건수 맥락 추가

모두 기존 테이블(`invoices`, `contracts`)로 계산 가능. 신규 데이터 없음.

## 2. 최종 레이아웃
```
[핵심 지표 · md:grid-cols-3]
  미수금 합계        이달 수익          이번 달 예정 입금(신규)
  ₩...              ₩...              ₩...
  미입금 N건         입금 N건           지급기한 도래 N건
[계약 파이프라인 · 신규 · 가로 스트립]
  초안 N · 서명완료 N · 진행중 N · 완료 N
[임박/지연 지급기한(기존)]        [채널 수익 TOP(기존)]
```
- 건수 배지는 기존 두 카드의 설명 문구에 `미입금 N건` / `입금 N건`으로 통합(리포트 페이지 미수·연체 카드와 동일 패턴).
- `이번 달 예정 입금` = **미입금** 인보이스 중 `due_date`가 이번 달(KST)인 건의 `amount` 합계. 색상은 amber 계열(주의·예정).

## 3. 데이터 계층 (집계는 SQL — CLAUDE.md 규칙)
신규 마이그레이션 `supabase/migrations/0006_dashboard_additions.sql`:

### (a) `get_dashboard_totals()` 컬럼 확장
반환 타입이 바뀌므로 `drop function get_dashboard_totals();` 후 재생성. 추가 컬럼:
- `outstanding_count bigint` — 미입금 건수
- `monthly_paid_count bigint` — 이달 입금 건수
- `expected_this_month_amount bigint` — 이번 달 지급기한 미입금 합계
- `expected_this_month_count bigint` — 그 건수

`expected_this_month`는 `date_trunc('month', i.due_date) = date_trunc('month', (now() at time zone 'Asia/Seoul')::date)` 조건.

### (b) `get_dashboard_contract_pipeline()` 신규
```sql
select c.status::text, count(*)::bigint
from contracts c
where c.deleted_at is null
group by c.status
```
- `security invoker` + RLS 스코프(기존 RPC와 동일 패턴).

### (c) 타입 재생성
`mcp__supabase__generate_typescript_types` 또는 CLI로 `src/types/database.ts` 갱신.

## 4. 순수 함수 + TDD (lib/metrics.ts)
- `summarizeContractPipeline(rows): { status, label, count }[]`
  - 정규 순서 `[draft, signed, active, done]`로 정렬, 누락 상태는 0으로 채움, 한글 라벨(초안/서명완료/진행중/완료) 매핑. `canceled`는 제외.
  - **테스트 먼저 작성**: 빈 입력→전부 0, 순서 보장, 누락 채움, canceled 제외.
- 건수·예정입금은 SQL 집계라 페이지에서 렌더만 함(별도 순수 함수 불필요).

## 5. UI (dashboard/page.tsx)
- `DashboardTotals` 타입·`DashboardRpcClient`에 신규 컬럼/RPC 추가.
- `Promise.all`에 `get_dashboard_contract_pipeline` 추가.
- 핵심 지표 섹션 `md:grid-cols-2` → `md:grid-cols-3`, 예정 입금 카드 추가.
- 두 기존 카드 설명에 건수 병기.
- 파이프라인 스트립 카드 추가(임박/채널 섹션 위).
- 빈 상태(`hasDashboardData`) 로직은 그대로 유지.

## 6. 검증
- `npm run test` — `summarizeContractPipeline` 테스트 통과.
- `npm run build` / `npm run lint` 통과.
- 브라우저(dev-browser)로 데모 데이터 상태에서 3개 추가 요소 렌더 확인.

## 7. 열린 결정
- **예정 입금 정의**: "이번 달 지급기한 미입금"으로 가정. "다음 7일" 또는 "오늘 이후 이번 달"로 바꿀지 확인 필요.
- **파이프라인 표시**: 상태별 4개 건수로 가정. `진행 중(draft+signed+active) 합계` 한 숫자로 단순화할지 확인 필요.
- **canceled 계약**: 파이프라인에서 제외 가정.

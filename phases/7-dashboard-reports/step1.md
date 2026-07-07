# Step 1: reports-csv

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. 집계는 SQL·KST, CSV·집계는 **서버 전용**(`app/api` 라우트 핸들러). 읽기 페이지는 RSC 직접 조회.
- `/docs/UI_GUIDE.md` — 리포트 테이블·연도 필터·빈 상태·통화 표기. `/docs/UX_PRINCIPLES.md` — 계층·판독성.
- `/CLAUDE.md` — CRITICAL: 집계는 SQL·변환만 JS. CSV/시크릿/서버 전용 로직은 `app/api` 라우트 핸들러 또는 서버 전용 모듈에서만(클라이언트 직접 호출 금지). 서버 인가는 `getUser()`.
- 이전 phase/step 산출물(실제 경로 — 그대로 재사용):
  - `src/app/(dashboard)/reports/page.tsx` — 현재 **플레이스홀더**(비활성 "CSV 내보내기" 버튼 포함). 실제 리포트로 교체.
  - **step 0 집계 함수**: `supabase/migrations/0005_dashboard_metrics.sql`의 채널별 수익 집계(연도 파라미터가 필요하면 함수에 인자를 추가하거나 리포트용 함수를 이 마이그레이션/새 마이그레이션에 추가). `.rpc()`로 호출.
  - `src/lib/metrics.ts` — `formatKRW`, `topChannelsByRevenue`, `ChannelRevenueRow`(리포트 표시/정렬 변환에 재사용. 집계는 SQL).
  - **서버 라우트 레퍼런스**(구조 그대로): `src/app/api/invoices/[id]/pdf/route.ts` — `requireUser()` 인가 → RLS 조회 → 응답 헤더(`content-type`·`content-disposition`·`cache-control: private, no-store`). CSV도 이 형태.
  - `src/lib/auth.ts` `requireUser()`, `src/lib/supabase/server.ts` `createClient()`, `src/lib/db/index.ts` `notDeleted`.
  - `src/types/database.ts` — `invoices`(`net_amount`·`paid_at`·`issue_date`·`payment_status`)·`clients`(`channel`).
  - `src/components/channel-badge.tsx`, `src/components/ui/*`.

**배경**: 이 step은 **채널별 수익 리포트 화면 + 서버 CSV 내보내기**다. 회계·세무 정리를 위해 채널별 수익을 연도로 필터해 보고, CSV로 내보낸다. **집계는 SQL, CSV 생성은 서버 라우트**에서만.

## 작업

### 1) 리포트 페이지 — `src/app/(dashboard)/reports/page.tsx` 교체

- **RSC 직접 조회**. **연도 필터**(`searchParams`, 기본 올해 KST). 선택 연도의 채널별 수익 집계를 `.rpc()`로 받아 표로 표시(`formatKRW`·`topChannelsByRevenue` 변환). 합계 행 포함.
- **집계 기준을 명시**한다: 수익은 **입금 기준**(`payment_status='paid'` 이고 `paid_at`의 연도(KST) = 선택 연도)로 집계. (issue_date 기준이 아님 — UI에도 "입금 기준" 문구를 노출.) ARCHITECTURE가 다른 기준을 정의하면 그걸 따르되 **한 기준으로 고정하고 화면에 표기**.
- **CSV 내보내기 버튼**: 아래 CSV 라우트로 링크(연도 쿼리 전달). 클라이언트에서 CSV를 만들지 마라.
- **빈 상태**: 해당 연도 입금 0건이면 빈 상태.

### 2) CSV 라우트 — `src/app/api/reports/route.ts`(또는 `reports/csv/route.ts`) 신규

- **서버 전용**. `requireUser()` 인가 → 연도 쿼리(`?year=`) 검증 → **동일 SQL 집계(`.rpc()`)로 채널별 수익 조회**(JS로 합산 금지) → CSV 문자열 생성 → 응답.
- 응답 헤더: `content-type: text/csv; charset=utf-8`, `content-disposition: attachment; filename="freesign-report-{year}.csv"`, `cache-control: private, no-store`. **한글 깨짐 방지**를 위해 UTF-8 BOM(`﻿`) 프리픽스 권장(Excel 호환).
- CSV 컬럼: 채널·수익(원) 등 리포트와 동일 기준. 숫자는 로캘 포맷이 아닌 원시 정수(회계 재가공 용이)로 하되 재량.

### 3) 테스트

- CSV **직렬화가 순수 함수**라면(rows → CSV 문자열) `src/lib/`로 분리해 테스트(콤마/따옴표 이스케이프·BOM). 라우트 자체는 AC(build + 200)로. 집계 SQL은 step 0 하네스에 연도 필터 케이스가 있으면 확장.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test          # CSV 직렬화/집계 테스트 통과, 기존 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 채널 수익 **집계가 SQL(`.rpc()`)**인가(JS 합산 아님)?
   - 수익 **기준(입금 기준·`paid_at` 연도 KST)** 이 화면·문서에 명시됐는가?
   - CSV 생성이 **서버 라우트(`app/api`)**에서만 이뤄지는가(클라이언트 생성 아님)?
   - CSV에 인가(`requireUser`)·RLS가 적용되는가? 헤더·BOM(한글)·filename이 올바른가?
   - 리포트 페이지가 **RSC 직접 조회 + 연도 필터**인가?
3. `phases/7-dashboard-reports/index.json`의 step 1을 업데이트(성공/실패/blocked).

## 금지사항

- CSV를 클라이언트에서 생성하지 마라. 이유: CRITICAL — CSV/집계는 서버 전용(`app/api`).
- 채널 수익을 JS에서 SUM/GROUP BY 하지 마라. 이유: 집계는 SQL.
- 수익 집계 기준(paid_at vs issue_date)을 모호하게 두지 마라. 이유: 세무 리포트는 기준이 명확해야 함 — 입금 기준으로 고정·표기.
- 대시보드/데모 데이터 기능을 만들지 마라. 이유: step 0·2 소관.
- `service_role` 키를 요청 경로에서 쓰지 마라. 이유: CRITICAL — service_role은 CLI 시드에서만.
- 기존 테스트를 깨뜨리지 마라.

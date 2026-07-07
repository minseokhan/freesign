# Step 0: contract-read

## 읽어야 할 파일

- `/docs/PRD.md` — 기능2·3(계약서 작성·서명). 계약이 제품의 방어 코어("기록 체인")의 시작점.
- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. 라우트 표(`/contracts` 목록, `/contracts/[id]` 상세 = 조항·평문요약·PDF·서명·하위 인보이스·이력 타임라인), contracts 모델(컬럼·`status` enum: `draft|signed|active|done|canceled`·`clauses` jsonb·`doc_hash`·`signature_meta`), "상태 전이 머신"(전이는 이벤트 로그에 append → 상세 이력 타임라인).
- `/docs/UI_GUIDE.md` — 상태 배지(pill, 전 화면 동일)·이력 타임라인·조항/평문요약 카드·테이블(목록). 상태 색: draft(중립)·signed/active(진행)·done(완료 green)·canceled(중립/취소). 시맨틱 색+텍스트 라벨 병기.
- `/docs/UX_PRINCIPLES.md` — 계층·3초 판독·빈 상태
- `/CLAUDE.md` — CRITICAL: 읽기는 RSC 직접 조회(내부 `/api` fetch 금지). `deleted_at IS NULL`은 공용 헬퍼에서.
- 이전 phase 산출물(실제 경로):
  - `src/app/(dashboard)/contracts/page.tsx` — 현재 **플레이스홀더**. 실제 목록으로 교체.
  - **phase 4 읽기 패턴 레퍼런스**(그대로 따라라): `src/app/(dashboard)/clients/page.tsx`(RSC 목록+`notDeleted`+채널 배지+필터), `src/app/(dashboard)/clients/[id]/page.tsx`(단건 조회+`notFound()`), `src/components/channel-badge.tsx`(코드→라벨+색 매핑 컴포넌트 패턴)
  - `src/lib/db/index.ts` — `notDeleted(query)` 헬퍼(조회에 필수)
  - `src/lib/supabase/server.ts` — `createClient()`(RLS 스코프 서버 클라이언트)
  - `src/types/database.ts` — `contracts`·`contract_events` Row 타입, `contract_status` enum
  - `src/components/ui/{card,badge,button}.tsx` — 프리미티브

**배경**: 이 step은 **계약 수직 슬라이스의 "읽기"**다. phase 4에서 정립한 **RSC 직접 조회 패턴을 그대로 재사용**한다. 계약은 clients보다 필드가 많고(상태·조항·이력) UI가 풍부하지만, **읽기 전용**이라는 원칙은 동일하다. AI 생성·편집·서명·PDF·상태전이는 step 1~5 소관 — 이 step은 **표시만** 한다.

## 작업

### 1) 목록 — `src/app/(dashboard)/contracts/page.tsx` 교체

- **RSC에서 Supabase 직접 조회**(`.from("contracts")`에 `notDeleted(...)` 적용). client 이름을 함께 보이려면 FK 조인 select(예: `client:clients(name)`) 또는 별도 조회. 정렬 `created_at desc` 재량.
- 목록 UI: UI_GUIDE 테이블 규격 — 제목·클라이언트·금액(tabular-nums 우측 정렬)·**상태 배지**·기간. 상태 필터(선택, `searchParams`).
- **상태 배지 컴포넌트**: `contract_status`(5값) → 한국어 라벨 + 배지 색 매핑. `channel-badge.tsx` 패턴을 따라 `src/components/contract-status-badge.tsx`로 만든다. 순수 표시 상수는 컴포넌트에 co-locate(TDD 가드 예외). 상태 6개 phase에서 재사용되므로 여기서 확정.
- **빈 상태**: 계약 0건 시 빈 상태 + "계약 만들기"(진입점은 `/contracts/new`, 실제 생성은 step 1 — 여기서는 링크 자리).

### 2) 상세 — `src/app/(dashboard)/contracts/[id]/page.tsx` 신규

- **RSC 직접 조회**. `params.id`로 단건(`notDeleted`, `maybeSingle()`), 없으면 `notFound()`.
- 표시 영역(UI_GUIDE):
  - **조항 카드 + 평문요약 카드**: `clauses` jsonb를 읽어 조항 목록·`plain_summary`를 렌더. **AI 면책 배너**(AI 초안은 법적 자문이 아님)를 상세에 노출.
  - **상태 배지** + 기본 정보(클라이언트·금액·기간).
  - **이력 타임라인**: `contract_events`를 `created_at` 순으로 조회해 상태 전이 이력을 타임라인으로. (이벤트는 append-only — 읽기만.)
  - PDF·서명·상태전이 버튼·하위 인보이스 영역은 **자리만**(실제 동작은 step 3·4·5, 인보이스는 phase 6). 비활성 또는 placeholder.

## Acceptance Criteria

```bash
npm run lint
npm run build     # /contracts 목록·[id] 상세 RSC가 컴파일
npm test          # 기존 테스트 green (+ lib에 순수 매핑을 넣었다면 그 테스트)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 목록·상세가 **RSC 직접 조회**인가(내부 `/api` fetch 없음)?
   - 조회에 **`notDeleted`**를 적용했는가?
   - 상태가 **배지(색+텍스트 라벨)**로, 이력이 **타임라인**으로 표시되는가?
   - 상세에 **AI 면책 배너**가 있는가?
   - 없는 id는 `notFound()`인가?
   - (dashboard) 레이아웃 가드가 덮으므로 page에 `requireUser()` 중복이 없는가?
3. `phases/5-contracts/index.json`의 step 0을 업데이트(성공 `completed`+`summary` / 3회 실패 `error`+`error_message` / 개입 필요 `blocked`+`blocked_reason`).

## 금지사항

- 읽기를 내부 `/api`로 우회하지 마라. 이유: CRITICAL — 읽기는 RSC 직접 조회.
- Server Action·AI 호출·서명·PDF·상태전이 로직을 만들지 마라. 이유: 각각 step 1~5 소관. 이 step은 읽기 전용 — 스코프 크립 금지.
- `contract_events`에 INSERT 하지 마라. 이유: 이벤트 생성은 상태전이(step 3)·서명(step 4) 소관. 여기서는 read-only.
- 인보이스(하위) 목록/생성을 만들지 마라. 이유: phase 6 소관.
- 기존 테스트를 깨뜨리지 마라.

# Step 5: entrypoint

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/CONTRACT_IMPORT_PLAN.md` — "변경/생성 파일 §8". 진입점을 "새 계약 작성"/"기존 계약 불러오기" 두 갈래로.
- `/docs/UI_GUIDE.md` — 버튼·빈 상태 규격.
- `src/app/(dashboard)/contracts/page.tsx` — **이 step의 유일한 수정 대상**. 헤더의 단일 "계약 만들기" 버튼과 빈 상태 카드의 CTA 버튼 위치를 확인.
- step 4 산출물 `src/app/(dashboard)/contracts/import/page.tsx` — 링크 대상 경로 `/contracts/import` 존재 확인.

## 작업

### 진입점 버튼 분기 — `src/app/(dashboard)/contracts/page.tsx` 수정

- 헤더의 단일 "계약 만들기"(현재 `/contracts/new`로 가는 버튼)를 **두 버튼**으로 교체:
  - "새 계약 작성" → `/contracts/new` (기존 primary 스타일 유지)
  - "기존 계약 불러오기" → `/contracts/import` (secondary/outline 스타일)
- 빈 상태 카드의 CTA도 동일하게 두 버튼(또는 primary "새 계약 작성" + 보조 링크 "기존 계약 불러오기")으로 제공한다.
- 기존 버튼 컴포넌트(`components/ui/button.tsx`)와 링크 패턴을 그대로 재사용한다. **외과적 변경**: 버튼 영역만 수정하고 목록 조회·렌더 로직은 건드리지 마라.

## Acceptance Criteria

```bash
npm run lint
npm run build      # /contracts 페이지가 컴파일
npm test           # 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 헤더와 빈 상태 **양쪽**에 "새 계약 작성"(→`/contracts/new`)과 "기존 계약 불러오기"(→`/contracts/import`) 두 진입점이 있는가?
   - 목록 조회/렌더 로직을 건드리지 않았는가(외과적 변경)?
3. 결과에 따라 `phases/9-contract-import/index.json`의 step 5를 업데이트한다.

## 금지사항

- 목록 조회·필터·렌더 로직을 리팩토링하지 마라. 이유: 이 step은 진입점 버튼만 수정하는 외과적 변경.
- 새 계약 생성/불러오기 로직을 이 파일에 넣지 마라. 이유: 각각 `/contracts/new`·`/contracts/import` 페이지 소관.
- 기존 테스트를 깨뜨리지 마라.

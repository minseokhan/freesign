# Step 2: ui-primitives

## 읽어야 할 파일

먼저 아래 파일들을 읽고 컴포넌트 스펙을 파악하라:

- `/docs/UI_GUIDE.md` — **컴포넌트 섹션이 1차 스펙**: 카드, KPI 스탯 카드, 상태 배지(pill), 버튼(Primary/Secondary/Text/Danger), 입력 필드. 색·라디우스·섀도우 토큰
- `/docs/UX_PRINCIPLES.md` — 일관성·접근성(포커스 링·터치 타깃 ≥44px·라벨 병기)
- 이전 step 산출물: Tailwind 설정·`globals.css`(디자인 토큰), `tsconfig.json`(`@/*` alias), `package.json`

이전 step에서 정의한 디자인 토큰을 **그대로 사용**해 컴포넌트를 만든다. 토큰과 다른 하드코딩 색·반경을 새로 도입하지 마라.

## 작업

**재사용 UI 프리미티브**를 `src/components/ui/`에 만든다. 기능 화면은 이후 phase 소관이니 여기서는 원자 컴포넌트만.

1. **`lib/utils.ts`의 `cn()` 헬퍼** — `clsx` + `tailwind-merge` 조합. `lib/`는 TDD 가드 대상이므로 **간단한 단위 테스트를 먼저 작성**(클래스 병합·조건부 클래스 케이스)한 뒤 구현하라.
2. **shadcn/ui 초기화**(선택) 또는 동등한 수동 컴포넌트. 어느 쪽이든 아래 컴포넌트를 UI_GUIDE 스펙대로 `src/components/ui/`에 둔다. `components/`는 TDD 가드 예외지만, 렌더/variant 스모크 테스트를 붙이면 회귀 방지에 좋다(선택).
   - **Button** — variant: `primary`(blue-600/hover blue-700), `secondary`(white+border), `text`, `danger`(red, 파괴적 액션용). `focus-visible:ring-2 ring-blue-500`, `disabled:opacity-50`(제출 중 비활성). 시그니처: `<Button variant={...} disabled={...} />`.
   - **Card** — `rounded-[14px] bg-white border-slate-200` + raised 소프트 섀도우 + `p-6`.
   - **Badge**(상태 pill) — variant: `success`(완료/입금), `warning`(임박), `danger`(미수/지연), `neutral`(draft/canceled). **색만이 아니라 텍스트 라벨을 항상 함께**(children으로) 렌더. `rounded-full` + 시맨틱 색.
   - **Input** — `rounded-[6px] border-slate-300`, `focus:border-blue-500 ring-blue-500/30`, 에러 상태(`border-red-500` + `aria-describedby` 연결 가능한 구조), 라벨 연결·터치 타깃 ≥44px.
3. 접근성: 의미 있는 아이콘엔 `aria-label`, 장식용 `aria-hidden`. 상태 배지는 색 + 텍스트 라벨 병기(색각 이상 대비).

## Acceptance Criteria

```bash
npm run build   # 타입·컴파일 에러 없음
npm run lint    # 통과
npm test        # cn() 테스트 + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 컴포넌트가 `src/components/ui/`에 있고 `types/`·`lib/` 분리 원칙을 지키는가? (CLAUDE.md: 컴포넌트는 `components/`, 순수 함수는 `lib/`)
   - Button/Badge variant가 UI_GUIDE 색·라디우스 토큰을 재사용하는가? (새 하드코딩 색 없음)
   - Badge가 색 + 텍스트 라벨을 병기하는가? (접근성)
   - `cn()`에 대응 테스트가 있는가? (TDD)
3. 결과에 따라 `phases/0-foundation/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "생성된 프리미티브 목록·cn 헬퍼 요약"`
   - 실패 → `"error"` + `error_message`, 개입 필요 → `"blocked"` + `blocked_reason`

## 금지사항

- 도메인 컴포넌트(계약 카드·인보이스 폼·대시보드 위젯·이력 타임라인)를 만들지 마라. 이유: 각 기능 phase(4~7) 소관. 여기서는 도메인 무관 원자 컴포넌트만.
- 새 색·반경 값을 하드코딩하지 마라. 이유: step 1의 토큰 단일 소스가 무너지고 UI 일관성이 깨진다.
- `lib/utils.ts`를 테스트 없이 구현하지 마라. 이유: `.codex` TDD 가드가 `lib/` 소스 편집을 차단한다.
- 기존 테스트를 깨뜨리지 마라.

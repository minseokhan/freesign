# Step 1: design-tokens

## 읽어야 할 파일

먼저 아래 파일들을 읽고 디자인 시스템의 의도를 파악하라:

- `/docs/UI_GUIDE.md` — **이 step의 1차 스펙**. 디자인 토큰(스페이싱·라디우스·엘리베이션·타이포), 색상(표면·텍스트·브랜드 블루·시맨틱), AI 슬롭 안티패턴 표
- `/docs/UX_PRINCIPLES.md` — 계층·대비·접근성(WCAG AA) 배경
- 이전 step에서 생성된 `tsconfig.json`, `src/app/layout.tsx`, `package.json`, `next.config.ts`

이전 step에서 세운 Next.js 스캐폴딩을 확인하고, 그 위에 Tailwind와 디자인 토큰을 얹는다.

## 작업

**Tailwind CSS + UI_GUIDE 디자인 토큰**을 설정한다. 컴포넌트는 다음 step 소관이니 여기서는 **토큰·글로벌 스타일·폰트 배선**까지만.

1. **Tailwind 설치·설정**(Next.js 15 방식). `src`를 content 경로에 포함.
2. **디자인 토큰을 Tailwind theme로 이식**(UI_GUIDE.md 값 그대로):
   - **색상**: 표면(slate-50 배경·white 카드·slate-100/200/300), 텍스트(slate-900/700/500/400), 브랜드 블루(primary #2563eb·hover #1d4ed8·ring #3b82f6·point-bg #eff6ff), 시맨틱(완료 green-600/#f0fdf4, 임박 amber-600/#fffbeb, 지연 red-600/#fef2f2, 중립 slate). Tailwind 기본 팔레트로 충분한 값은 재정의하지 말고, 시맨틱 별칭이 필요하면 최소한으로.
   - **라디우스 위계**: sm 6 · md 10 · lg 14 · full. (전부 같은 반경 금지 — 안티슬롭)
   - **엘리베이션**: raised·overlay 소프트 섀도우를 UI_GUIDE 값 그대로 유틸/토큰화. (컬러 글로우·펄스 금지)
   - **스페이싱**은 4px 베이스(Tailwind 기본과 정합).
3. **globals.css**: 페이지 배경 slate-50, 본문 텍스트 색, `tabular-nums`가 필요한 곳에 쓸 수 있게 base 설정, `prefers-reduced-motion` 존중(모션 최소화 시 transition 제거) base rule.
4. **Pretendard 폰트 배선**: Tailwind `fontFamily.sans`의 첫 폰트를 `Pretendard`로 지정(fallback 포함). **실제 폰트 로드(`<link>` 또는 next/font)는 app-shell(step 4)에서 root layout에 추가**하므로 여기서는 fontFamily 참조만 잡는다. (PDF용 TTF 임베드는 PDF phase 소관 — 여기서 폰트 파일을 받지 마라.)

이 step의 파일은 대부분 **스타일/설정**(Tailwind config·CSS)이라 TDD 가드 예외 대상이다. 별도 단위 테스트는 요구하지 않으나, 기존 스모크 테스트는 계속 green이어야 한다.

## Acceptance Criteria

```bash
npm run build   # Tailwind 포함 빌드 성공
npm run lint    # 통과
npm test        # 기존 테스트 green 유지
```

빌드 후 토큰이 실제로 반영되는지 확인하려면 `src/app/page.tsx`에 임시로 토큰 클래스(예: `bg-slate-50 text-slate-900 rounded-[14px]`)를 적용해 `npm run build`가 통과하는지 본다. (임시 확인용이며 최소로.)

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/디자인 체크리스트:
   - UI_GUIDE.md **AI 슬롭 안티패턴 표**를 위반하지 않았는가? (backdrop-filter blur, gradient-text, 보라/인디고 브랜드색, 배경 gradient orb, 글로우 애니메이션, 모든 요소 동일 rounded 금지)
   - 라디우스 위계(sm/md/lg/full)와 색 팔레트가 UI_GUIDE 값과 일치하는가?
   - 브랜드색이 **블루 1색**인가? (보라/인디고 금지)
3. 결과에 따라 `phases/0-foundation/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "Tailwind 토큰·globals·폰트 배선 요약"`
   - 실패 → `"error"` + `error_message`, 개입 필요 → `"blocked"` + `blocked_reason`

## 금지사항

- shadcn/ui나 개별 컴포넌트(Button·Card·Badge)를 만들지 마라. 이유: ui-primitives(step 2) 소관.
- root layout에 폰트 `<link>`/next/font를 넣지 마라. 이유: app-shell(step 4)에서 레이아웃과 함께 배선하며, 지금 넣으면 두 step이 같은 파일을 다투게 된다.
- UI_GUIDE 안티패턴(글래스·그라데이션·네온·보라색)을 어기지 마라. 이유: 제품의 핵심 디자인 정체성(뉴트럴+블루 1색)을 훼손한다.
- 기존 테스트를 깨뜨리지 마라.

# FreeSign — 랜딩 페이지 · 프로필/로그아웃 · 로고 · UX 개선 계획

## Context

브라우저에서 직접 사용하며 발견한 4가지 개선 요청:

1. **진입 경험 부재** — `/` 접근 시 UI 없이 곧바로 `/login`으로 리다이렉트(`src/app/page.tsx`)되어, "이게 뭘 하는 서비스인가"를 설명하는 소개/랜딩 페이지가 없다. greetinghr.com처럼 서비스 소개 + 대시보드 미리보기 + 기능 설명을 담은 인터랙티브 랜딩에서 "로그인"으로 이어지길 원함.
2. **프로필·로그아웃 미노출** — 로그인해도 프로필 이름/사진이 어디에도 안 보이고, `signOut` 기능 자체가 프로젝트 전체에 미구현. 헤더 우상단에는 빈 점선 placeholder만 존재(`src/app/(dashboard)/layout.tsx:29-32`).
3. **로고가 텍스트뿐** — 로고가 전부 "FreeSign" 텍스트. 제공된 `freesign` 워드마크(진한 'free' + 블루 'sign' + 물결 밑줄)로 교체 희망.
4. **UX 유입·단계 진행 개선** — `docs/UX_PRINCIPLES.md` 기준으로 유저 유치와 단계별 진행(퍼널)을 개선할 지점을 파악·정리.

**결정된 방향(사용자 확인 완료):**
- 랜딩은 **항상 표시**. 로그인 상태면 헤더 CTA만 "로그인" → "대시보드로 이동"으로 전환.
- 로고는 **인라인 SVG로 재현**(에셋 파일 불필요, 다크모드/스케일 대응).
- UX 항목 4는 **분석·정리만**(이 문서에 우선순위 목록으로). 실제 구현은 별도 결정.
- 프로필 드롭다운/로그아웃은 **의존성 추가 없이 직접 구현**(Radix/lucide/shadcn Avatar·DropdownMenu 미설치 상태 유지).

## 아키텍처 준수 사항 (CLAUDE.md)
- 쓰기는 Server Action에서만 → `signOut`은 서버 액션으로.
- 인가는 `getUser()` 기반(`requireUser()` 재사용).
- 신규 컴포넌트는 `src/components/`, 순수/표현 로직 분리. 디자인 토큰은 `tailwind.config.ts`의 것(`surface-*`, `text-*`, `brand-*`, `status-*`, spacing/radius/shadow 토큰) 재사용.
- **AI 슬롭 안티패턴 금지**(`UI_GUIDE.md`): glass/backdrop-blur, gradient-text, 네온 글로우, 보라/인디고, 배경 orb, 균일 rounded-2xl 금지. 방향은 강한 타이포 위계 · 넉넉한 여백 · 소프트 섀도우 · 절제된 모션.
- 모션은 `prefers-reduced-motion` 존중, fade/slide-in 150–200ms 범위.

---

## 1. 로고 컴포넌트 (선행 — 다른 작업이 의존)

**신규: `src/components/logo.tsx`** (서버 컴포넌트, 상태 없음)
- 인라인 SVG 워드마크: `free`(진한색) + `sign`(블루) + 하단 물결 밑줄(블루 stroke).
- `free`는 `currentColor`(다크모드 대응), `sign`·물결은 `text-brand-primary`(#2563eb) 계열 고정 또는 `fill-blue-600`.
- props: `className?`(높이/색 제어), 접근성 위해 `<svg role="img" aria-label="FreeSign">` + `<title>FreeSign</title>` 부여 → 기존 텍스트 "FreeSign"을 이름으로 쿼리하는 테스트/스크린리더 호환.
- 크기 위계: 사이드바/헤더용 소형(height ~20px), 랜딩 히어로/로그인용 중형(height ~28–32px)을 className으로.

**교체 위치:**
- `src/components/app-sidebar.tsx:27-32` — 텍스트 `FreeSign` `<Link>` 내부를 `<Logo>`로.
- `src/app/(auth)/login/page.tsx:50-52` — eyebrow 텍스트 "FreeSign"을 `<Logo>`로.
- 랜딩 헤더(아래 2절)에서 사용.
- 대시보드 헤더(`(dashboard)/layout.tsx`)의 eyebrow "FreeSign"은 사이드바 로고와 중복이므로 그대로 두거나 제거(외과적: 최소 변경 유지).
- 참고(선택, 이번 범위 밖): `settings/page.tsx`·dashboard 빈 상태의 "FS" 이니셜은 별개 플레이스홀더 — 건드리지 않음.

**검증:** `src/components/__tests__/app-sidebar.test.tsx`는 nav 링크를 role로 쿼리(로고 텍스트 미의존) — 확인 완료, 로고 교체에 안전. Logo에 `aria-label="FreeSign"` 부여로 스크린리더 이름 보존.

---

## 2. 랜딩 페이지 (`/`)

**`src/app/page.tsx` 변경** — 리다이렉트 전용 → 공개 랜딩 페이지.
- `getUser()`는 유지하되 리다이렉트 제거. `const { data: { user } } = ...`로 로그인 여부만 판별해 헤더 CTA 분기.
- `export const dynamic = "force-dynamic"` 유지(auth 조회).
- 로그인 사용자도 랜딩 표시(결정사항). CTA만 "대시보드로 이동"(`/dashboard`) vs 비로그인 "로그인"(`/login`).

**신규 컴포넌트 (`src/components/landing/`):**
- `landing-header.tsx` — 좌측 `<Logo>`, 우측 CTA 버튼(로그인 여부 prop으로 라벨/href 분기). 상단 고정(sticky) 얇은 헤더.
- `hero.tsx` — 강한 타이포 위계의 헤드라인("계약 → 서명 → 청구 → 입금 → 세금 정리를 한 흐름으로") + 서브카피 + primary CTA + 보조 텍스트. 히어로 하단에 대시보드 미리보기 배치.
- `dashboard-preview.tsx` — **실데이터 아님, 목업**. 실제 대시보드와 동일한 카드/배지/테이블 스타일(토큰 재사용)로 KPI(미수금·이달 수익) + 임박/지연 목록 + 채널 TOP를 정적 렌더. "미리보기" 캡션. `pointer-events-none aria-hidden`로 장식 처리.
- `flow-walkthrough.tsx` (**client, 인터랙티브 핵심**) — 계약→서명→청구→입금→세금 5단계 탭. 스텝 클릭 시 해당 단계 설명 + 대응 화면 목업 전환. `UI_GUIDE.md`의 스텝 인디케이터 시각 규칙 재사용(현재 blue-600, 완료 green, 이후 slate-300). 키보드 조작·`aria-selected` 부여. 이것이 "인터랙티브"의 중심.
- `feature-section.tsx` — 핵심 가치 3~4개(방어 코어 "계약→지급기한→입금 증빙 체인", AI 초안, 원천징수 자동계산, 세금 CSV)를 아이콘(인라인 SVG, strokeWidth 1.5) + 제목 + 설명 카드로.
- `landing-footer.tsx` — 간단한 푸터(면책/제품명/링크 최소).
- 모션: 섹션 진입 fade/slide-in(작은 client 래퍼 + IntersectionObserver 또는 CSS), `prefers-reduced-motion`에서 제거. 과장 bounce·글로우 금지.

**레이아웃 주의:** 랜딩은 `(dashboard)` 그룹 밖(`app/page.tsx`)이라 대시보드 사이드바/헤더가 적용되지 않음 — 랜딩 전용 헤더/푸터를 자체 구성. 배경은 `surface-page`, 콘텐츠 `max-w-6xl` 그리드.

**검증:** 로그아웃 상태로 `/` 접근 시 리다이렉트 없이 랜딩 노출, CTA "로그인" → `/login`. 로그인 상태에선 CTA "대시보드로 이동". 스텝 탭 클릭 시 목업 전환.

---

## 3. 프로필 · 로그아웃 (헤더)

**신규 서버 액션: `src/app/(auth)/actions.ts`** (또는 `src/lib/auth-actions.ts`)
```ts
"use server";
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/"); // 랜딩으로
}
```
- 쓰기=Server Action 규칙 준수. `revalidatePath` 불필요(redirect가 전체 이동).

**신규: `src/components/user-menu.tsx`** (client, 의존성 없이 직접 구현)
- props: `{ name: string; email: string; avatarUrl: string | null }`.
- 아바타: `avatarUrl` 있으면 plain `<img>`(Google `lh3.googleusercontent.com` 원격 — next/image 아님이라 config 불필요, `referrerPolicy="no-referrer"`), 없으면 이니셜 fallback(`rounded-full` 아바타, `UI_GUIDE` full radius).
- 트리거 버튼 클릭 → 드롭다운 토글. 드롭다운 내용: 이름/이메일 + `<form action={signOut}>` 로그아웃 버튼(danger 스타일 분리 배치).
- 접근성: `aria-haspopup="menu"`, `aria-expanded`, Escape 닫기, 외부 클릭 닫기(document mousedown 리스너 + ref), 포커스 링. `shadow-overlay`(드롭다운 토큰) 적용.

**`src/app/(dashboard)/layout.tsx` 변경:**
- `await requireUser()` → `const user = await requireUser()`로 사용자 확보.
- 표시 필드 추출: 이름 `user.user_metadata.full_name ?? user.user_metadata.name ?? user.email`, 아바타 `user.user_metadata.avatar_url ?? user.user_metadata.picture ?? null`, 이메일 `user.email`.
- 우상단 점선 placeholder 박스(29-32)를 `<UserMenu name={...} email={...} avatarUrl={...} />`로 교체.

**검증(TDD — auth 경계):** `user-menu` 렌더 테스트(이름 표시, 로그아웃 버튼 존재, 드롭다운 토글). `signOut` 액션은 `supabase.auth.signOut()` 호출 후 redirect 확인(기존 callback route 테스트 패턴 참고: `src/app/auth/callback/__tests__/route.test.ts`).

---

## 4. UX 개선 분석 (분석·정리만 — 구현은 별도)

`docs/UX_PRINCIPLES.md`의 플로우별 체크리스트 기준, 유입·단계 진행 관점 우선순위. **이번 구현 범위 아님 — 참고 목록.**

**A. 첫 진입/온보딩 (유입 핵심)**
- 랜딩 CTA → 로그인 → 대시보드 **빈 상태**로 도착. 빈 상태에 "데모 데이터 채우기"는 있으나(`DemoDataButton`), 그다음 "실제로 뭘 먼저 할지"(클라이언트 등록→계약→인보이스) **온보딩 넛지/체크리스트 부재**. → 대시보드 빈 상태에 3단계 진행 체크리스트(① 클라이언트 ② 계약 ③ 인보이스) 제안.
- 빈 상태 "FS" 이니셜 대신 로고 마크 사용으로 브랜드 일관성.

**B. 단계 간 전환(퍼널 연결)**
- `contracts/new`에서 클라이언트 0명이면 "클라이언트 만들기"로 유도(있음). 반대로 **클라이언트 등록 완료 후 "계약 만들기"로 잇는 다음 액션 CTA** 부재 가능성 → 각 생성 완료 시 다음 단계 CTA(계약→서명/인보이스) 제안.
- `UX_PRINCIPLES §2` 스텝 인디케이터: `contracts/new` AI 초안 플로우에 현재 단계 표시가 실제 있는지 점검(구조화 입력→초안→편집→확정). 없으면 추가 권장.

**C. 계층·스캔성(대시보드)**
- KPI가 2개(미수금·이달 수익)뿐 — `UX_PRINCIPLES §7` "3초 스캔"에 부합하고 `text-3xl` KPI 계층은 잘 지켜짐(양호). 유지.

**D. 상태·피드백 완결성**
- 로그아웃이 없던 것처럼, **모든 상태 존재 원칙**(로딩/빈/에러/성공) 화면별 점검 — 특히 신규 랜딩·프로필 메뉴에 로딩/에러 상태 정의.

**E. 신뢰·전환 요소(랜딩)**
- 면책/보안(RLS·private storage) 메시지, "무료로 시작" 명확화 등 전환 카피 정리. AI는 "초안" 면책 노출(`UI_GUIDE` 면책 배너) — 랜딩에서도 과대광고 금지.

> 우선순위: **A(온보딩 체크리스트) > B(단계 연결 CTA) > D/E**.

---

## 구현 순서

1. `Logo` 컴포넌트 + 기존 텍스트 로고 3곳 교체 → 테스트 확인.
2. `signOut` 서버 액션 + `UserMenu` + 대시보드 헤더 배선 → 테스트.
3. 랜딩 컴포넌트 세트 + `app/page.tsx` 전환.
4. UX 분석 목록은 본 문서로 전달(구현 대기).

## 검증 (엔드투엔드)

- `npm run test` — 신규(user-menu, signOut) + 기존(app-sidebar, login) 통과.
- `npm run dev` 후 수동:
  - 로그아웃 상태 `/` → 랜딩 노출, 스텝 탭 인터랙션 동작, "로그인" CTA → `/login`.
  - 로그인 → 헤더 우상단 아바타/이름 노출, 드롭다운 → 로그아웃 → `/`(랜딩)로 이동, 세션 해제 확인.
  - 사이드바·로그인·랜딩에서 SVG 로고 렌더(다크/라이트, 확대 시 선명).
- `npm run lint` · `npm run build` 통과.
- `npx playwright test` — 기존 E2E는 `/login`·`/dashboard`로 직접 이동하고 `/` 루트 리다이렉트에 의존하지 않음(확인 완료). 랜딩 추가로 회귀 없음 예상.

# Step 4: app-shell

## 읽어야 할 파일

먼저 아래 파일들을 읽고 정보구조(IA)와 레이아웃 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "페이지 구조 (IA)" 섹션(라우트 목록), 디렉토리 구조의 `app/(auth)`·`app/(dashboard)` 라우트 그룹
- `/docs/UI_GUIDE.md` — "레이아웃" 섹션(max-w-6xl/max-w-3xl, 좌측 사이드 내비 활성 blue-50/blue-600, 상단 페이지 헤더), 빈 상태 컴포넌트
- `/docs/UX_PRINCIPLES.md` — 상태·피드백 원칙(로딩·빈·에러·성공 모든 상태 정의), 일관성(내비 활성 표시)
- 이전 step 산출물: `src/components/ui/*`(Button·Card·Badge·Input), `src/app/layout.tsx`(최소 root layout), Tailwind 토큰·`globals.css`, `src/middleware.ts`

## 작업

**앱 셸(레이아웃 골격)**을 만든다. 인증·실데이터는 이후 phase 소관이니, 여기서는 **내비게이션이 도는 껍데기 + 상태 파일 베이스**까지만.

1. **root layout**(`src/app/layout.tsx`) 완성:
   - `<html lang="ko">`, Pretendard 웹폰트 로드(step 1에서 fontFamily는 `Pretendard`로 잡아둠 — 여기서 실제 로드를 배선). **CDN `<link>`(Pretendard dynamic-subset) 또는 next/font 중 택1**, 저장소에 TTF 파일을 추가하지 마라(PDF용 TTF 임베드는 PDF phase 소관).
   - `<body>`에 페이지 배경(slate-50)·기본 텍스트 색 적용.
2. **(dashboard) 라우트 그룹 레이아웃**(`src/app/(dashboard)/layout.tsx`):
   - **좌측 사이드 내비** — 항목: 대시보드·클라이언트·계약·인보이스·리포트·설정(ARCHITECTURE IA 순). 활성 항목 `bg-blue-50 text-blue-600`(UI_GUIDE). 내비는 클라이언트 컴포넌트로 현재 경로 활성 표시.
   - **상단 페이지 헤더 슬롯** — 제목 + 우상단 primary 액션 자리(UI_GUIDE 레이아웃). 컨텐츠 영역 `max-w-6xl`.
   - CRITICAL: 이 레이아웃에 **인증 가드(`getUser()` 리다이렉트)를 넣지 마라** — phase 3(auth) 소관. 지금은 공개 셸.
3. **플레이스홀더 라우트 페이지**(각각 `src/app/(dashboard)/<route>/page.tsx`): `dashboard`·`clients`·`contracts`·`invoices`·`reports`·`settings`. 각 페이지는 **빈 상태 스텁**(UI_GUIDE 빈 상태 컴포넌트: 문구 + CTA 자리)만. 실데이터·기능 없음.
4. **루트 `/`**: `src/app/page.tsx`를 `/dashboard`로 redirect(인증 도입 전 임시). phase 3에서 auth 흐름에 맞게 교체될 것임을 주석으로 남겨라.
5. **상태 파일 베이스**: (dashboard) 그룹에 `loading.tsx`(스켈레톤)·`error.tsx`(에러 바운더리, 클라이언트 컴포넌트) 기본형을 둔다. UX_PRINCIPLES "모든 상태 존재" 원칙.

app/ 페이지·레이아웃은 UI 셸이며 도메인 로직·데이터 조회가 없다. 렌더 스모크 테스트는 선택이나, 기존 테스트는 green 유지.

## Acceptance Criteria

```bash
npm run build   # 모든 라우트 컴파일 성공
npm run lint    # 통과
npm test        # 기존 테스트 green 유지
```

빌드 후 `npm run dev`로 `/dashboard`·`/clients` 등 라우트가 200으로 열리고 사이드 내비 활성 표시가 도는지 확인한다. (dev 확인은 수동, AC는 build 기준.)

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 라우트 그룹이 `app/(dashboard)/` 구조인가? (ARCHITECTURE 디렉토리 구조)
   - (dashboard) 레이아웃에 **인증 가드가 없는가?** (phase 3 소관 — 지금 넣으면 미완 auth로 셸이 막힘)
   - 사이드 내비 활성색이 blue-50/blue-600(UI_GUIDE)인가? AI 슬롭 안티패턴 없나?
   - 로딩·빈·에러 상태 파일이 존재하는가? (UX_PRINCIPLES)
3. 결과에 따라 `phases/0-foundation/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "app-shell·사이드내비·플레이스홀더 라우트·상태파일 요약"`
   - 실패 → `"error"` + `error_message`, 개입 필요 → `"blocked"` + `blocked_reason`
4. 이 step이 완료되면 phase 0(foundation)의 마지막 step이다.

## 금지사항

- (dashboard) 레이아웃/페이지에 `getUser()` 인증 가드·리다이렉트를 넣지 마라. 이유: phase 3(auth) 소관. 미완 인증 로직이 셸 검증을 막는다.
- 플레이스홀더 페이지에 실데이터 조회·Server Action·도메인 기능을 넣지 마라. 이유: 각 기능 phase(4~7) 소관. 여기서는 라우팅 껍데기만.
- 저장소에 폰트 TTF 파일을 추가하지 마라. 이유: 웹 폰트는 CDN/next-font로 충분하고, PDF용 임베드는 PDF phase가 별도 처리한다.
- `next.config`에 PDF/런타임 설정을 넣지 마라. 이유: PDF phase 소관.
- 기존 테스트를 깨뜨리지 마라.

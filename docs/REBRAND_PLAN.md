# 리브랜딩 계획: FreeSign → 매듭(Maedeup)

> 이 문서는 **세션이 끊겨도 이어서 진행**할 수 있도록 진행 상황을 체크박스로 기록한다.
> Phase 3(외부 콘솔 작업)은 2026-08-04 완료됐고, 그 클릭 단위 런북이던
> `docs/REBRAND_MANUAL_TASKS.md`는 역할을 다해 삭제했다. 남은 것은 Phase 4와
> 검증 1건이며 아래에 통합돼 있다.

작성일: 2026-08-03

---

## 0. 확정 사항 (Decisions)

| 항목 | 값 | 비고 |
|---|---|---|
| 한글 브랜드명 | **매듭** | UI 기본 표기. 조사 결합 시 "매듭이/매듭을" |
| 라틴 표기 | **Maedeup** | 도메인·패키지명·영문 문맥 |
| 도메인 | **maedeup.app** | Cloudflare 구매 완료 · Vercel 연결 완료 · **DNS 미설정** |
| 앱 URL | `https://maedeup.app` | `NEXT_PUBLIC_SITE_URL` |
| 발신 메일 | `매듭 <no-reply@maedeup.app>` | Resend 도메인 인증 필요 |
| 메인 컬러 | `#2b3587` (남색) | 로고 워드마크 색 |
| 액센트 | `#4e61f6` (블루) | 로고 심볼 밝은 링 |
| 패키지명 | `maedeup` | package.json |
| GitHub 레포 | `minseokhan/freesign` → `maedeup` | **맨 마지막**, 기존 링크 만료 후 |

### 컬러 토큰 매핑 (tailwind.config.ts `colors.brand`)

| 토큰 | 기존 | 신규 | 용도 |
|---|---|---|---|
| `brand.primary` | `#2563eb` | `#2b3587` | 기본 버튼·링크 |
| `brand.hover` | `#1d4ed8` | `#212a6c` | hover/active |
| `brand.ring` | `#3b82f6` | `#4e61f6` | 포커스 링·강조 |
| `brand.point` | `#eff6ff` | `#eef0fb` | 옅은 배경 틴트 |

`surface.*`, `text.*`, `status.*`는 중립 슬레이트 계열이라 **그대로 유지**한다
(남색과 충돌 없음, 변경 범위 최소화).

### ⚠️ "매듭"은 2글자다 — 외부 서비스 등록명은 `Maedeup`

`min 3` 길이 검증을 두는 서비스에서 한글 브랜드명이 거부된다.
실제 사례: Polar 조직 생성 시 `{"loc":["body","name"],"input":"매듭","ctx":{"min_length":3}}`.

- **외부 서비스 조직·계정 등록명 → `Maedeup`** (슬러그는 `maedeup`)
- 사용자에게 보이는 **상품명·표시명은 한글** (`매듭 Pro` 등)
- 결제 인프라(Polar MoR + Stripe)의 영수증·정산 경로도 라틴 문자가 안전하다

### "매듭" 용어 체계 (도메인 용어)

브랜드명이 한글 단어이므로 UI 카피에 자연스럽게 녹인다.
**단, 남용 금지** — 계약을 "완결"짓는 행위에만 쓰고, 목록/조회/수정 같은
중립 동작에는 쓰지 않는다.

| 위치 | 기존 | 신규 |
|---|---|---|
| 계약 생성 CTA | 새 계약 / 계약 생성 | **계약 매듭짓기** |
| 랜딩 히어로 | 계약부터 입금·세금까지, 하나의 흐름으로 | **일의 시작과 끝을 매듭짓다** |
| 빈 상태 | 아직 계약이 없습니다 | 아직 매듭지은 계약이 없습니다 |
| 서명 완료 | 서명이 완료되었습니다 | 서명이 완료되어 계약이 매듭지어졌습니다 |

> **주의:** DB enum·status 값(`draft`/`sent`/`signed`/`completed`), 이벤트 타입,
> API 필드명은 **절대 변경하지 않는다.** 화면에 보이는 라벨만 바꾼다.

---

## 1. 실행 순서 (Phases)

### Phase 0 — 기반 (직접 수행)
- [x] 로고 색상 추출 (`#2b3587` / `#4e61f6`)
- [x] 계획 문서 작성 (`docs/REBRAND_PLAN.md`, 수동 작업 런북)
- [x] 로고 에셋 `public/brand/`에 복사, 파비콘(`src/app/icon.png`·`apple-icon.png`) 교체
- [x] `tailwind.config.ts` 브랜드 토큰 남색 전환
- [x] `src/components/logo.tsx` 매듭 워드마크로 재작성 + 테스트 갱신

### Phase 1 — 병렬 문자열/컬러 치환 (서브에이전트 4갈래)
디렉터리로 엄격히 분할해 충돌을 막는다.

- [x] **A**: `src/app/**` — 페이지·레이아웃·API 라우트·메타데이터 + 해당 `__tests__`
- [x] **B**: `src/components/**` — UI 컴포넌트·랜딩·PDF 문서 + 해당 `__tests__`
- [x] **C**: `src/lib/**`, `src/services/**`, `src/test/**` — 이메일 템플릿·SEO 상수·법적 문구 + 해당 `__tests__`
- [x] **D**: 루트 설정·문서 — `package.json`, `.env.example`, `README`/`SETUP.md`,
      `CLAUDE.md`, `AGENTS.md`, `docs/**`, `phases/**`, `evals/**`, `e2e/**`, `scripts/**`

### Phase 2 — 검증 게이트 (직접 수행)
- [x] `npm run lint`
- [x] `npm run test` (전부 통과)
- [x] `npm run build:verify`
- [x] `npx playwright test` (2/2 통과 — 최초 1회는 dev 서버 `.next` 스테일로 실패,
      서버 클린 재기동 후 그린. 메일 발송 403/422는 Resend 도메인 미인증 탓으로 예상된 결과)

### Phase 3 — 인프라 (자동 가능분만)
- [x] `.env.local`의 `NEXT_PUBLIC_SITE_URL`·`EMAIL_FROM` 갱신 (로컬)
- [x] `docs/EMAIL_DOMAIN_SETUP.md` maedeup.app 기준으로 갱신
- [x] Vercel 도메인 연결 — `maedeup.app`·`www.maedeup.app` 프로젝트에 추가 완료 (Vercel CLI)
- [x] Vercel 환경변수 — `NEXT_PUBLIC_SITE_URL=https://maedeup.app`·`EMAIL_FROM` 반영·재배포 완료
- [x] Supabase Auth Redirect URL
- [x] Cloudflare DNS (A `@` / CNAME `www`, 프록시 OFF) — 전 세계 전파·Let's Encrypt 발급 확인
- [x] Resend 도메인 인증
- [x] Polar webhook URL — 재생성(`maedeup.app`, 이벤트 4종). DB 시크릿은 의도적으로 유지 → MANUAL_TASKS §6
- [x] Google OAuth 동의 화면

### Phase 4 — 개명 (기존 링크 만료 후, 지금 하면 안 됨)

> 🔴 `*.vercel.app` 주소는 **Vercel 프로젝트 이름에서 자동 생성**된다.
> 개명하는 순간 `freesign.vercel.app`이 **사라지고**, 이미 발송된 서명·청구서
> 링크가 전부 죽는다. 서명 토큰 만료 기간이 지난 뒤(최소 수 주)에 진행한다.
> 개명을 아예 안 해도 서비스에는 지장이 없다 — 사용자에게 보이는 것은
> `maedeup.app`이고 `freesign.vercel.app`은 구 링크 수신용으로만 남는다.

- [x] `FALLBACK_SITE_URL` `freesign.vercel.app` → `maedeup.app` (Phase 1에서 선행 처리 완료)
- [ ] **Vercel 프로젝트명** — https://vercel.com/hanminseoks-projects/freesign/settings
      → `Project Name`을 `maedeup`으로 → Save
- [ ] **GitHub 레포명**
      ```bash
      gh repo rename maedeup --repo minseokhan/freesign
      cd ~/freesign && git remote set-url origin https://github.com/minseokhan/maedeup.git
      ```
- [ ] **Supabase 프로젝트명** — Settings → General → Project name.
      **project ref(`jbfxkcjeoqwcdsxuemug`)는 안 바뀌므로 안전**(연결 정보 그대로)
- [ ] **로컬 디렉터리** `cd ~ && mv freesign maedeup`
      → Claude Code 메모리 경로 `~/.claude/projects/-Users-hanms-freesign` 도 함께 이동
- [ ] `scripts/lighthouse-loop/measure.mjs`의 `VERCEL_URL`을 `https://maedeup.app`으로
      (DNS가 붙었으므로 지금 바꿔도 된다)
- [ ] 의도적으로 남긴 `freesign` 문자열 정리 — E2E 테스트 계정 `e2e-test@freesign.local`,
      `docs/SECURITY_NEXT_STEPS.md`의 Vercel 슬러그, `.claude/skills/db-advisor`의 Supabase 프로젝트명

### 남은 검증 1건

- [ ] **새 도메인에서 Google 로그인** — https://maedeup.app/login 에서 실제로 로그인.
      Supabase Redirect URL(Phase 3)과 Google OAuth 동의 화면이 제대로 걸렸는지
      확인하는 유일한 방법이다. 코드는 `NEXT_PUBLIC_SITE_URL + /auth/callback`으로
      돌아온다(`src/app/(auth)/login/page.tsx:30`).
      Supabase의 허용목록 검증은 authorize가 아니라 **callback 단계**에서 일어나므로
      외부에서 프로그램으로 확인할 수 없다.

### 리브랜딩 후 남는 사실

| 항목 | 내용 |
|---|---|
| 이미 발송된 서명·청구서 링크 | `freesign.vercel.app` 기준. Phase 4 전까지 정상 동작 |
| 이미 생성된 PDF | 안에 박힌 URL은 구 도메인. 재생성 전까지 그대로 |
| 완결증명서 | 발행처가 "매듭"으로 바뀜. 이전 발행분은 "FreeSign" — 발행 시점 기록이라 정상 |
| 검색엔진 | 새 도메인 인덱싱에 시간 필요. Search Console에 `maedeup.app` 등록 권장 |
| 구 도메인 allowlist | **없음.** `csp.ts`·`safe-redirect.ts`는 상대경로 기반 |
| 결제 | 프로덕션 전환 절차는 `docs/POLAR_PRODUCTION_CUTOVER.md` |

---

## 2. 치환 규칙 (에이전트 공통 규약)

```
FreeSign  → 매듭            (한국어 문맥·UI 카피)
FreeSign  → Maedeup         (영문 문맥·식별자·URL·이메일 주소)
freesign  → maedeup         (소문자 식별자·패키지·경로)
FREESIGN  → MAEDEUP         (상수·env 접두사가 있다면)
free sign → 매듭
freesign.vercel.app → maedeup.app
```

### 금지 사항 (surgical change 원칙)
- DB 컬럼·enum·status 문자열·이벤트 타입 변경 금지
- 마이그레이션 파일(`supabase/migrations/*.sql`)은 **과거 기록**이므로 수정 금지
  (주석 안의 "FreeSign"도 그대로 둔다 — 이미 원격에 적용된 파일)
- `package-lock.json`의 `"name": "freesign"`은 `package.json` 변경 후
  `npm install`로 자연 갱신 (직접 편집 금지)
- 브랜드와 무관한 인접 코드 리팩터링 금지
- 테스트 기대값은 "지금 화면 문구"가 아니라 **의도한 동작**에서 정한다

---

## 3. 진행 로그

| 날짜 | 내용 |
|---|---|
| 2026-08-03 | 계획 수립, Phase 0 완료 — 브랜드 토큰·로고·파비콘·에셋 |
| 2026-08-03 | Phase 1 A~D 병렬 완료 — 120 파일, 브랜드 문자열 전량 치환 + 매듭 용어 도입 |
| 2026-08-03 | Phase 2 게이트 그린 — lint / vitest 912 / build:verify / playwright 2 |
| 2026-08-03 | Vercel에 maedeup.app·www 연결 완료. 나머지 인프라는 MANUAL_TASKS로 분리 |
| 2026-08-04 | Phase 3 수동 항목 1~6 사용자 완료. `https://maedeup.app` 라이브, 앱 URL·발신 도메인 전환 |

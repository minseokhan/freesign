# Step 0: oauth-login

## 읽어야 할 파일

먼저 아래를 읽고 인증 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-001**(App Router, 시크릿은 서버 격리), **ADR-007**(OAuth E2E는 dev 전용 테스트 로그인으로 대체 — 실 Google 왕복은 자동 AC 대상이 아님)
- `/docs/ARCHITECTURE.md` — 기술 스택의 **Supabase Auth(Google OAuth) + `@supabase/ssr` + middleware 토큰 갱신**, 서버 인가는 `getUser()`. 디렉토리 구조의 `app/(auth)/login`, 페이지 IA의 `/login`
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: 시크릿·외부 API는 서버 전용, 서버 인가는 `getUser()`(`getSession()` 아님), middleware는 토큰 갱신 전용(보안 경계 아님)
- phase 0 산출물(반드시 정독):
  - `src/lib/supabase/server.ts` — 쿠키 기반 **서버** Supabase 클라이언트(`createClient()`). OAuth code 교환·쿠키 세팅은 이걸 쓴다.
  - `src/lib/supabase/client.ts` — 브라우저 클라이언트(`"use client"`)
  - `src/middleware.ts` — 이미 `supabase.auth.getUser()`로 토큰을 갱신 중(수정 금지 — 보안 경계로 바꾸지 마라)
  - `src/lib/env.ts` — `NEXT_PUBLIC_SITE_URL`(리다이렉트 목적지 조립에 사용), `getPublicEnv()`
  - `src/app/page.tsx` — 현재 임시로 `/dashboard`로 redirect("Phase 3에서 교체" 주석). **이 step에서는 건드리지 마라**(step 1 소관).

**배경**: phase 3은 인증·보호 경계 phase다. 이 step은 **로그인 진입점**만 만든다 — `/login` 페이지와 Google OAuth 시작 + 콜백 code 교환. (dashboard) 보호 가드는 step 1, dev 테스트 로그인은 step 2 소관이며 여기서 만들지 않는다.

**실 Google OAuth 설정에 대한 중요 지침**: 실제 Google 로그인 왕복은 Supabase 프로젝트에 Google provider·client id/secret·redirect URL 허용목록이 설정돼야 동작한다. 그건 **외부 대시보드 설정(런타임)** 이며, 이 step의 AC(빌드·테스트)는 그것 없이 통과해야 한다. **provider 미설정을 이유로 `blocked` 처리하지 마라** — 코드·빌드·(목) 테스트를 완성하고, 실 왕복 검증은 step 2(dev 테스트 로그인)·phase 8(E2E)·수동 몫임을 summary에 남겨라.

## 작업

`app/(auth)/login` 로그인 페이지와 OAuth 콜백 라우트 핸들러를 만든다.

### 1) 로그인 페이지 — `src/app/(auth)/login/page.tsx`

- **Server Component 페이지**. "Google로 계속하기" 버튼을 렌더한다.
- OAuth 시작은 **inline Server Action**으로 처리하라(`page.tsx` 안에 `"use server"` 함수). 이유: 별도 `actions.ts`/`route.ts`는 `.codex` TDD 가드 대상이지만 `page.tsx`는 예외다. 또한 PKCE code verifier 쿠키를 서버 클라이언트가 일관되게 세팅해야 한다.
- Server Action 로직:
  - `src/lib/supabase/server.ts`의 `createClient()`로 서버 클라이언트 생성.
  - `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: <SITE_URL>/auth/callback } })` 호출. `redirectTo`는 `getPublicEnv().NEXT_PUBLIC_SITE_URL`로 조립(하드코딩 금지).
  - 반환된 `data.url`로 `redirect(data.url)`(`next/navigation`). 오류 시 `/login?error=...`로 되돌린다.
- UI는 최소한으로(중앙 정렬 카드 + 버튼). 과설계 금지.

### 2) 콜백 라우트 핸들러 — `src/app/auth/callback/route.ts`

라우트 그룹 `(auth)`는 URL에 세그먼트를 더하지 않으므로, 콜백은 **실 세그먼트 `auth/callback`** 에 둔다(경로 `/auth/callback` — 위 `redirectTo`와 정확히 일치해야 한다).

- `GET(request)`: URL 쿼리에서 `code`를 읽는다.
- 서버 클라이언트로 `supabase.auth.exchangeCodeForSession(code)` 호출(쿠키에 세션 세팅됨).
- 성공 → `next` 파라미터가 있으면 그곳, 없으면 `/dashboard`로 `NextResponse.redirect`.
- 실패(또는 `code` 없음) → `/login?error=auth`로 redirect. 예외를 밖으로 던져 500이 나지 않게 하라.
- **오픈 리다이렉트 방지**: `next`는 앱 내부 상대경로(`/`로 시작, `//` 아님)만 허용하라. 외부 URL로의 리다이렉트를 막아라.

`route.ts`는 TDD 가드 대상이다 — **테스트를 먼저 작성**하라(`src/app/auth/callback/__tests__/route.test.ts` 또는 co-located). Supabase 서버 클라이언트를 **목**으로 주입/스텁해 실제 네트워크·Supabase 없이 검증하라:
- `code`가 있고 교환 성공 → `/dashboard`(또는 유효한 `next`)로 리다이렉트.
- `code`가 없음/교환 실패 → `/login?error=...`로 리다이렉트(throw 없음).
- `next`가 외부 URL이면 무시하고 `/dashboard`로(오픈 리다이렉트 차단).

### 하지 말 것 (이 step 범위 밖)

- `middleware.ts`를 수정하지 마라(토큰 갱신 전용 유지).
- (dashboard) 가드·`app/page.tsx` 리다이렉트를 손대지 마라(step 1).
- profiles 행 자동 생성(프로비저닝)을 하지 마라 — 이 phase 로드맵 범위 밖이다.
- 로그아웃·계정 메뉴를 만들지 마라(phase 3 로드맵에 없음).

## Acceptance Criteria

```bash
npm run lint
npm run build     # /login 페이지·/auth/callback 라우트가 타입·컴파일 에러 없이 빌드
npm test          # 콜백 라우트 목 테스트(테스트 먼저) + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `/login`이 `(auth)` 그룹의 Server Component이고, OAuth 시작이 서버 측(inline Server Action)에서 `signInWithOAuth`를 부르는가?
   - `redirectTo`가 `NEXT_PUBLIC_SITE_URL` 기반이고 콜백 경로(`/auth/callback`)와 일치하는가(하드코딩 아님)?
   - 콜백이 `exchangeCodeForSession`을 서버 클라이언트로 수행하고, 실패 시 throw 대신 `/login`으로 리다이렉트하는가?
   - `next` 오픈 리다이렉트를 차단하는가(내부 상대경로만)?
   - `middleware.ts`·`app/page.tsx`·(dashboard)를 건드리지 않았는가?
   - 콜백 테스트가 먼저 작성됐고 실 Supabase를 호출하지 않는가(목)?
3. `phases/3-auth/index.json`의 step 0을 업데이트:
   - 성공 → `"status": "completed"` + `"summary"`(생성 파일 경로·콜백 경로·실 Google 설정은 외부/수동임을 명시)
   - 3회 실패 → `"status": "error"` + `"error_message"`
   - (참고) Google provider 미설정은 blocked 사유가 **아니다** — 코드·빌드·테스트로 완결하라.

## 금지사항

- `service_role` 키를 로그인/콜백 경로에서 쓰지 마라. 이유: CRITICAL — service_role은 CLI 시드 전용, 요청 경로 금지.
- `getSession()`으로 인가하지 마라. 이유: 서버 인가는 `getUser()`(Supabase 서버에서 토큰 검증). (이 step은 code 교환이지만 이후 가드는 반드시 getUser.)
- `middleware.ts`를 보안 경계(리다이렉트 가드)로 바꾸지 마라. 이유: middleware는 토큰 갱신 전용. 가드는 step 1의 (dashboard) 레이어에서 `getUser()`로 한다.
- `redirectTo`·콜백 URL을 하드코딩하지 마라. 이유: 환경별(로컬/배포) 사이트 URL이 다르다. `NEXT_PUBLIC_SITE_URL`을 써라.
- `next`/리다이렉트 목적지로 외부 URL을 허용하지 마라. 이유: 오픈 리다이렉트 취약점.
- profiles 프로비저닝·로그아웃·(dashboard) 가드를 만들지 마라. 이유: 각각 범위 밖(다운스트림/step 1)이다.
- 기존 테스트를 깨뜨리지 마라.

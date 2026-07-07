# Step 1: session-guard

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "데이터 흐름"의 **읽기**(`사용자 → 보호 라우트(RSC) → getUser() 인가 → Supabase 직접 조회`), 기술 스택(서버 인가는 `getUser()`, `getSession()` 아님)
- `/docs/ADR.md` — ADR-001(App Router·RSC), ADR-007(보안 경계 자동 검증 필수)
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: 서버 인가는 `getUser()`. middleware는 토큰 갱신 전용(보안 경계 아님). 보안 경계는 특히 테스트 필수(TDD).
- phase 0 산출물:
  - `src/app/(dashboard)/layout.tsx` — 현재 `getUser()` 가드가 **비어 있는** 레이아웃(헤더·사이드바만). 여기에 가드를 붙인다.
  - `src/app/page.tsx` — 현재 무조건 `/dashboard`로 redirect("Phase 3에서 교체" 주석). 이 step에서 정리한다.
  - `src/lib/supabase/server.ts` — `createClient()`(서버 클라이언트, `getUser()` 호출처)
- phase 3 step 0 산출물: `src/app/(auth)/login/page.tsx`(미인증 리다이렉트 목적지 `/login`), `src/app/auth/callback/route.ts`

**배경**: 이 step에서 **처음으로 (dashboard) 전체에 `getUser()` 보호 경계가 붙는다.** phase 4~7의 모든 보호 라우트가 이 가드 아래에서 동작한다. (dashboard) 레이아웃 가드 + 재사용 가능한 인가 헬퍼 + 루트 `/` 진입 정리까지가 범위다.

## 작업

### 1) 인가 헬퍼 — `src/lib/auth.ts`

`getUser()` 인가는 **보안 경계**이므로 재사용 가능한 순수 경로로 만들고 **TDD**한다(테스트 먼저: `src/lib/__tests__/auth.test.ts`).

시그니처(예시 — 형태는 재량):
```ts
import type { User } from "@supabase/supabase-js";
// 서버 클라이언트로 getUser()를 호출해 인증 사용자를 반환. 미인증이면 /login으로 redirect(반환 안 함).
export async function requireUser(): Promise<User>;
```

- 내부에서 `src/lib/supabase/server.ts`의 `createClient()`로 서버 클라이언트를 만들고 `supabase.auth.getUser()`를 호출한다.
- `data.user`가 없으면(또는 error) `redirect("/login")`(`next/navigation`) — 호출측은 이후 `user`가 항상 존재한다고 가정할 수 있다.
- **반드시 `getUser()`를 써라. `getSession()` 금지**(session은 검증 없이 쿠키를 신뢰 → 위조 가능).

**테스트**(supabase 서버 클라이언트·`next/navigation`을 목):
- 인증 사용자 존재 → 그 user를 반환하고 redirect를 호출하지 않는다.
- 미인증(`user: null`) → `redirect("/login")`을 호출한다.
- `getUser()`를 호출하고 `getSession()`을 호출하지 않는지(정확한 API 사용) 검증.

### 2) (dashboard) 가드 — `src/app/(dashboard)/layout.tsx` 수정

- 레이아웃(async Server Component) 최상단에서 `await requireUser()`를 호출한다. 미인증이면 헬퍼가 `/login`으로 리다이렉트하므로 보호된 UI가 렌더되지 않는다.
- **외과적 변경**: 기존 헤더·사이드바 마크업·스타일은 건드리지 마라. 가드 호출만 추가한다.

### 3) 루트 진입 정리 — `src/app/page.tsx` 수정

- 현재의 무조건 `/dashboard` redirect를 인증 상태 기반으로 바꾼다: 서버 클라이언트 `getUser()` 결과가 있으면 `/dashboard`, 없으면 `/login`으로 redirect. "Phase 3에서 교체" 임시 주석을 제거한다.
- `page.tsx`는 TDD 가드 예외지만, 여기서도 `getUser()`를 써라(`getSession()` 금지).

### 하지 말 것 (범위 밖)

- `middleware.ts`에 리다이렉트/가드를 추가하지 마라(토큰 갱신 전용 유지 — 보안 경계는 서버 컴포넌트 `getUser()`).
- (dashboard) 하위 개별 page(clients·contracts 등)에 가드를 중복으로 넣지 마라 — 레이아웃 가드가 그룹 전체를 덮는다. (개별 page의 `user_id` 사용은 phase 4~7에서 필요 시 `requireUser()`를 재사용.)
- 로그인 UI·OAuth 로직을 수정하지 마라(step 0 확정본).

## Acceptance Criteria

```bash
npm run lint
npm run build     # 가드가 붙은 (dashboard) 레이아웃·루트 페이지가 컴파일
npm test          # requireUser 단위테스트(테스트 먼저) + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `requireUser`가 `getUser()`(not `getSession()`)로 인가하고, 미인증 시 `/login`으로 redirect하는가?
   - (dashboard) 레이아웃이 렌더 전에 `requireUser()`를 호출하는가?
   - 루트 `/`가 인증 상태에 따라 `/dashboard` 또는 `/login`으로 가는가(임시 주석 제거)?
   - `middleware.ts`를 건드리지 않았는가(토큰 갱신 전용)?
   - 보안 경계 테스트가 먼저 작성됐는가(TDD)?
3. `phases/3-auth/index.json`의 step 1을 업데이트(성공 `completed`+summary / 3회 실패 `error` / 개입 필요 `blocked`).

## 금지사항

- `getSession()`으로 인가하지 마라. 이유: 세션 쿠키를 검증 없이 신뢰 → 위조 가능. `getUser()`는 Supabase 서버에서 토큰을 검증한다.
- `middleware.ts`를 가드로 만들지 마라. 이유: CRITICAL — middleware는 토큰 갱신 전용, 보안 경계 아님. RSC의 `getUser()`가 경계다.
- (dashboard) 레이아웃의 기존 마크업·스타일을 리팩터/개선하지 마라. 이유: 외과적 변경 원칙 — 가드 추가만이 이 step의 요청이다.
- 개별 하위 페이지에 가드를 중복 삽입하지 마라. 이유: 레이아웃 가드가 그룹을 덮는다. 중복은 유지보수 부담·불일치 위험.
- 기존 테스트를 깨뜨리지 마라.

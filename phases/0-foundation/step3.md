# Step 3: supabase-clients

## 읽어야 할 파일

먼저 아래 파일들을 읽고 데이터 접근·보안 경계의 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 기술 스택의 Supabase 항목(`@supabase/ssr`·middleware 토큰 갱신·`getUser()`), "패턴(렌더링·데이터 접근)" 섹션
- `/docs/ADR.md` — ADR-002(Supabase 순수 클라이언트 + 생성 타입, RLS 1차 접근제어)
- `/CLAUDE.md`, `/AGENTS.md` — CRITICAL: 서버 인가는 `getUser()`(`getSession()` 아님), middleware는 **토큰 갱신 전용(보안 경계 아님)**, `service_role`은 요청 경로 절대 금지
- `/.env.example` — 정의된 환경 변수(`NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`ANTHROPIC_API_KEY`·`NEXT_PUBLIC_SITE_URL`)
- 이전 step 산출물: `src/lib/utils.ts`, `tsconfig.json`(`@/*`), `package.json`, Vitest 설정

## 작업

**Supabase 클라이언트 모듈 + 환경변수 런타임 검증**을 만든다. 이 step은 클라이언트 "인스턴스 생성"과 "env 스키마"까지만 — **실제 DB 조회·인증 로직은 phase 3(auth) 이후 소관**.

1. **`src/lib/env.ts`** — zod로 환경변수 런타임 검증. `lib/`는 TDD 가드 대상 → **테스트 먼저**:
   - 유효한 env → 파싱 성공, 필수 키 누락/형식 오류 → 명확한 에러.
   - `NEXT_PUBLIC_*`(공개)와 서버 전용(`SUPABASE_SERVICE_ROLE_KEY`·`ANTHROPIC_API_KEY`)을 구분해 스키마화. **`SUPABASE_SERVICE_ROLE_KEY`는 서버 전용 스키마에만** 두고 클라이언트 번들에서 접근 불가하게(파일 분리 또는 접근 함수로).
2. **`src/lib/supabase/server.ts`** — `@supabase/ssr`의 `createServerClient`로 쿠키 기반 서버 클라이언트 생성 함수. Server Component/Server Action에서 사용. 생성 타입 제네릭(`Database`) 적용.
3. **`src/lib/supabase/client.ts`** — `createBrowserClient`로 브라우저 클라이언트. anon key만 사용.
4. **`src/middleware.ts`** — `@supabase/ssr` 세션 토큰 **갱신 전용** 미들웨어. CRITICAL: 여기서 인가 판단(라우트 보호)을 하지 마라 — middleware는 보안 경계가 아니다. 보호는 phase 3에서 `getUser()`로 각 라우트/레이아웃에서 수행한다. matcher는 정적 자산 제외 표준 패턴.
5. **`src/types/database.ts`** — Supabase 생성 타입 **자리표시 스텁**. phase 1(database)에서 실제 스키마로 `supabase gen types`가 덮어쓸 것이므로, 지금은 컴파일이 되는 최소 `Database` 타입(빈 `public.Tables` 등)을 두고 파일 상단에 "phase 1에서 자동 생성으로 교체" 주석을 남겨라. `types/`는 TDD 가드 예외.

**주의**: 이 step에서 실제 Supabase 프로젝트에 접속하거나 키를 요구하지 마라. 클라이언트 "생성 함수"만 정의하고, 런타임 접속은 하지 않는다. env 값이 없어도 **빌드·테스트는 통과**해야 한다(테스트는 목/더미 env 사용).

## Acceptance Criteria

```bash
npm run build   # 타입·컴파일 에러 없음 (생성 타입 스텁 기준)
npm run lint    # 통과
npm test        # env 검증 테스트 + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 보안 체크리스트(CLAUDE.md CRITICAL):
   - `middleware.ts`가 **토큰 갱신 전용**인가? 라우트 인가·리다이렉트 로직을 넣지 않았는가?
   - `SUPABASE_SERVICE_ROLE_KEY`가 클라이언트 번들(`client.ts`·`NEXT_PUBLIC_*`)에서 접근 불가한가?
   - 서버/클라이언트 클라이언트가 각각 `createServerClient`/`createBrowserClient`로 올바르게 분리됐는가?
   - `lib/env.ts`에 대응 테스트가 있는가? (TDD)
3. 결과에 따라 `phases/0-foundation/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "env 스키마·supabase server/client·middleware·types 스텁 요약"`
   - 실패 → `"error"` + `error_message`
   - **실제 Supabase 키·프로젝트가 있어야만 진행 가능한 상황이면** → `"blocked"` + `blocked_reason`. 단, 위 지침대로면 키 없이도 완료 가능해야 하므로 blocked 전에 목 env로 재시도하라.

## 금지사항

- 실제 DB 조회·auth 로직(`getUser()` 호출로 라우트 보호 등)을 넣지 마라. 이유: phase 3(auth) 소관이며, 지금은 클라이언트 배선만.
- `service_role` 키를 Server Action/`app/api`/브라우저 경로에서 쓰는 코드를 만들지 마라. 이유: CLAUDE.md CRITICAL 위반(요청 경로 절대 금지, CLI 시드 전용).
- `middleware.ts`에 인가/리다이렉트를 넣지 마라. 이유: middleware는 보안 경계가 아니다. 넣으면 `getUser()` 기반 방어를 우회하는 착각을 준다.
- `types/database.ts`를 실제 스키마로 손으로 채우지 마라. 이유: phase 1에서 마이그레이션 기준으로 자동 생성한다. 스텁만 둔다.
- 기존 테스트를 깨뜨리지 마라.

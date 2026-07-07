# Step 1: client-actions

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. "데이터 흐름"의 **쓰기**(`Server Action → getUser() 인가 → zod 검증 → Supabase 쓰기 → revalidatePath`). clients 모델(도메인 필드: `name`·`channel`·`contact_email`·`contact_phone`·`memo`).
- `/CLAUDE.md` — CRITICAL(그대로 박아라):
  - **쓰기는 Server Actions에서만**(`revalidatePath`로 갱신).
  - Server Action은 **client 입력 전용 zod allowlist(도메인 필드만)**만 받고, **`user_id`는 항상 `getUser()`에서**, 서버 소유 필드(`is_demo`·`deleted_at`·`created_at`·`updated_at` 등)는 **client 입력 금지**.
  - 모든 사용자 데이터는 RLS `USING` + `WITH CHECK (user_id = (select auth.uid()))` 둘 다 스코프(이미 phase 1에서 적용됨 — Server Action은 그 위에서 `user_id`를 서버가 채운다).
- `/docs/ADR.md` — ADR-007(보안 경계 자동 검증 필수 = TDD)
- 이전 phase 산출물(실제 경로):
  - `src/lib/auth.ts` — `requireUser(): Promise<User>`. **`user_id`의 유일한 출처.** Server Action 최상단에서 호출.
  - `src/lib/supabase/server.ts` — `createClient()`(RLS 스코프 서버 클라이언트, 쓰기 수행)
  - `src/lib/db/index.ts` — `notDeleted(query)`, `assertOwned(supabase, table, id)`. **수정·삭제 전 소유권/존재 재확인**에 활용 가능(단건 update/soft-delete 대상이 본인 소유인지). RLS가 이미 스코프하지만 명시적 재확인은 방어적.
  - `src/types/database.ts` — `clients` `Insert`/`Update` 타입(`channel` CHECK: `linkedin|instagram|youtube|direct|kmong|referral|other`)
  - `src/app/(dashboard)/clients/page.tsx`, `.../[id]/page.tsx` — step 0 목록/상세(수정·삭제 후 `revalidatePath` 대상 경로)
- **참고(TDD 레퍼런스)**: `src/services/payment/__tests__/provider.test.ts` 등 기존 테스트 스타일, `src/lib/db/__tests__/index.test.ts`(supabase 클라이언트 목 패턴)

**배경**: 이 step은 **첫 CRUD 수직 슬라이스의 "쓰기" 절반**이다. 여기서 정립하는 **Server Action 패턴(zod allowlist + `user_id`는 서버 + `revalidatePath`)**을 phase 5·6의 모든 쓰기가 그대로 따른다. clients는 **가장 단순한 케이스**(이벤트 로그 없음·FK 없음)라 패턴 레퍼런스로 최적이다.

## 작업

이 step의 산출물은 **보안 경계**다(입력 검증·인가·`user_id` 소유권). 따라서 **TDD 필수 — 테스트를 먼저 작성**하라.

### 1) zod allowlist 스키마 (테스트 먼저)

- **client 입력으로 허용할 도메인 필드만** 정의: `name`(필수, non-empty), `channel`(7개 CHECK 값의 enum), `contact_email`(optional, email 형식), `contact_phone`(optional), `memo`(optional). **`user_id`·`is_demo`·`deleted_at`·타임스탬프·`id`는 스키마에 넣지 마라**(서버 소유/비입력).
- 이 스키마는 **step 2 폼에서도 재사용**된다(클라이언트 검증 = 서버 재검증 동일 스키마). 따라서 **공유 가능한 위치**에 둔다 — 예: `src/lib/validation/client.ts`. `lib/`에 두므로 **대응 테스트(`src/lib/validation/__tests__/client.test.ts`)를 먼저** 작성해야 TDD 가드를 통과한다.
- **테스트**: 유효 입력 통과 / `name` 빈 값 거부 / `channel` 미허용 값 거부 / `user_id` 같은 **미허용 필드가 들어와도 무시(strip)되거나 거부**되는지(allowlist 검증) / email 형식 검증.

### 2) Server Actions — `src/app/(dashboard)/clients/actions.ts`

파일 상단 `"use server"`. 각 액션 최상단에서 `const user = await requireUser()`로 **인가 + `user_id` 확보**.

시그니처(예시 — 형태 재량, FormData/객체 입력은 step 2 폼과 정합되게):
```ts
"use server";
// 생성: 도메인 필드 zod 검증 → { ...입력, user_id: user.id } insert → revalidatePath("/clients")
export async function createClient(input: unknown): Promise<...>;
// 수정: id + 도메인 필드 검증 → 소유권(RLS/assertOwned) → update → revalidatePath("/clients", "/clients/[id]")
export async function updateClient(id: string, input: unknown): Promise<...>;
// soft-delete: id → deleted_at = now() UPDATE(하드삭제 아님) → revalidatePath("/clients")
export async function deleteClient(id: string): Promise<...>;
```

핵심 규칙(박아라):
- **`user_id`는 반드시 `user.id`(getUser)에서.** client 입력의 `user_id`는 절대 신뢰/사용하지 마라.
- **zod allowlist로만 도메인 필드를 받는다.** 검증 실패 시 액션은 쓰기 없이 에러 반환(폼이 표시).
- **삭제는 soft-delete**(`deleted_at` 세팅), 하드삭제 금지(복원·감사·CSV 보존). `deleted_at` 값은 **서버에서** 세팅(client 입력 금지).
- 수정·삭제 대상이 본인 소유인지 — RLS가 이미 스코프하나, `assertOwned`로 명시적 재확인하거나 update 결과 rowcount로 확인(방어적). 타인 행에 대한 쓰기는 RLS로 no-op이 되어야 한다.
- 성공 시 **`revalidatePath`로 목록/상세를 갱신**(내부 fetch 캐시 무효화 아님).
- **이벤트 로그를 기록하지 마라** — clients는 이벤트 테이블이 없다(도메인 3테이블 중 이벤트는 contract/invoice만).

### 3) 액션 테스트 (테스트 먼저)

- supabase 서버 클라이언트·`requireUser`·`revalidatePath`를 목.
- `createClient`: 유효 입력 → insert 페이로드에 **`user_id: user.id`가 채워지고** client가 보낸 `user_id`는 무시되는지, `revalidatePath` 호출.
- `deleteClient`: **하드 delete가 아니라 `deleted_at` UPDATE**인지.
- 검증 실패 입력(빈 `name`·잘못된 `channel`) → 쓰기가 일어나지 않는지.
- 서버 소유 필드(`is_demo`·`deleted_at`)를 client 입력으로 밀어넣어도 insert/update 페이로드에 반영되지 않는지.

## Acceptance Criteria

```bash
npm run lint
npm run build     # Server Actions·스키마가 컴파일
npm test          # zod 스키마 + 액션 보안 테스트(테스트 먼저) + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `user_id`가 **`getUser()`(requireUser)에서만** 오고, client 입력 `user_id`를 신뢰하지 않는가?
   - **zod allowlist(도메인 필드만)**로 입력을 받고, 서버 소유 필드를 client 입력으로 받지 않는가?
   - 삭제가 **soft-delete(`deleted_at`)**인가(하드삭제 아님)?
   - 성공 후 `revalidatePath`로 갱신하는가?
   - clients에 **이벤트 로그를 추가하지 않았는가**(테이블 없음)?
   - 보안 경계 테스트가 **먼저** 작성됐는가(TDD)?
3. `phases/4-clients/index.json`의 step 1을 업데이트(성공 `completed`+`summary` / 3회 실패 `error`+`error_message` / 개입 필요 `blocked`+`blocked_reason`).

## 금지사항

- `user_id`를 client 입력에서 받지 마라. 이유: CRITICAL — 소유권 위조·타 user 데이터 삽입 가능. 항상 `getUser()`에서.
- 서버 소유 필드(`is_demo`·`deleted_at`·타임스탬프·`id`)를 zod allowlist에 넣거나 client 입력으로 쓰지 마라. 이유: CRITICAL — client가 소유/상태 필드를 조작.
- 하드 delete 하지 마라. 이유: soft-delete가 규칙(복원·감사·CSV 보존). 하드삭제 시 감사 체인 유실.
- 쓰기를 route handler(`/api`)나 클라이언트에서 하지 마라. 이유: CRITICAL — 쓰기는 Server Actions 전용.
- clients에 이벤트 INSERT를 넣지 마라. 이유: clients는 이벤트 테이블이 없다(contract/invoice만 append-only 이벤트). 스코프 밖.
- **폼 UI를 만들지 마라.** 이유: step 2(client-form) 소관. 이 step은 액션·검증 로직까지만.
- 테스트 없이 액션/스키마 로직을 작성하지 마라. 이유: 보안 경계 = TDD 필수(`.codex` 가드가 `lib/` 로직을 차단).

# Step 2: demo-data

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. 쓰기는 Server Action에서만(`revalidatePath`). `is_demo` 플래그·soft-delete(`deleted_at`)·FK `ON DELETE RESTRICT`. 이벤트 append-only.
- `/docs/UX_PRINCIPLES.md` — 피드백·확인(파괴적 액션). `SCENARIO.md`(있으면) — 데모 샘플(무디) 여정.
- `/CLAUDE.md` — CRITICAL: 쓰기는 Server Action, `user_id`는 `getUser()`. **서버 소유 필드(`is_demo`·금액 스냅샷·`paid_at`)는 서버가 설정**(client 입력 아님 — Server Action 내부에서 서버가 직접 세팅하는 것은 허용). `service_role`은 요청 경로 금지(**Server Action은 RLS 클라이언트 사용**).
- 이전 phase/step 산출물(실제 경로 — 그대로 재사용):
  - **데모 샘플 데이터 형태 레퍼런스**: `src/lib/db/seed.ts`의 `seedDemo(exec, userId)` — 무디 client/contract/invoice 샘플(조항·금액 3,000,000·원천징수 `wt_3_3`·paid 등). **주의: seed.ts는 CLI `service_role`+raw pg(요청 경로 금지). 이 step은 그 "데이터 내용"만 재사용하고, 삽입은 RLS 스코프 Supabase 클라이언트로 한다.**
  - `src/lib/tax.ts` — `calcWithholding`(데모 인보이스 스냅샷 계산).
  - **Server Action 레퍼런스**: `src/app/(dashboard)/invoices/actions.ts`·`src/app/(dashboard)/contracts/actions.ts`(`requireUser` → RLS insert → 이벤트 append → `revalidatePath`).
  - `src/app/(dashboard)/dashboard/page.tsx` — step 0 대시보드(비활성 "데모 데이터 채우기" 버튼 → 이 step에서 실제 배선).
  - `src/lib/auth.ts` `requireUser()`, `src/lib/supabase/server.ts` `createClient()`, `src/lib/db/index.ts` `assertOwned`.
  - `src/types/database.ts` — `clients`·`contracts`·`invoices`(모두 `is_demo`·`deleted_at`), `contract_events`·`invoice_events`(**`is_demo` 컬럼 없음** — 데모 이벤트는 데모 도메인 행의 `contract_id`/`invoice_id`로 식별).

**배경**: 이 step은 **앱 안에서 데모 데이터를 채우고/지우는** Server Action이다. 처음 온 사용자가 빈 화면 대신 무디 샘플로 제품을 체험하고, 원할 때 깨끗이 지운다. **모든 삽입/삭제는 현재 사용자 소유(`user_id`=getUser)·RLS 스코프**로, `is_demo=true`만 다룬다.

## 작업

**TDD: 데모 채우기/지우기는 로직 소스(`app/(dashboard)` actions). 테스트를 먼저 작성하라** — 특히 **지우기가 `is_demo=true`만 하드삭제**하고 실데이터를 건드리지 않는지, **삭제 순서(FK RESTRICT)**가 맞는지. 레퍼런스: `src/app/(dashboard)/contracts/__tests__/actions.test.ts`.

### 1) 데모 Server Actions — `src/app/(dashboard)/demo/actions.ts`(또는 유사) 신규

시그니처(재량, 반환형은 기존 액션 패턴):

```ts
export async function seedDemoData(): Promise<{ ok: true } | { ok: false; error: string }>;
export async function clearDemoData(): Promise<{ ok: true } | { ok: false; error: string }>;
```

**`seedDemoData` 규칙**:
1. `const user = await requireUser()`. **RLS 스코프 Supabase 클라이언트**로 insert(`service_role`·raw pg 금지).
2. `seed.ts`의 무디 샘플 내용을 재사용해 client → contract → invoice 순으로 insert. **모든 행 `is_demo = true`**(서버가 세팅), `user_id = user.id`. 인보이스 스냅샷(`withholding_amount`·`net_amount`)은 **`calcWithholding`로 서버 계산**.
3. **중복 방지**: 이미 데모 데이터가 있으면(같은 user의 `is_demo=true` 존재) no-op 또는 먼저 clear 후 재삽입 — 재량이나 중복 누적 금지.
4. (선택) 상태 이력을 위해 데모 계약/인보이스 이벤트를 append(도메인 insert **성공 후**). `revalidatePath`로 `/dashboard`·`/clients`·`/contracts`·`/invoices` 갱신.

**`clearDemoData` 규칙(순서가 핵심 — FK `ON DELETE RESTRICT`)**:
1. `requireUser()` → RLS 스코프.
2. **삭제 순서**: ① 데모 인보이스의 `invoice_events` 삭제 → ② 데모 계약의 `contract_events` 삭제 → ③ `invoices`(is_demo) → ④ `contracts`(is_demo) → ⑤ `clients`(is_demo). 자식(이벤트·인보이스) → 부모(계약·클라이언트) 순. **역순으로 하면 FK RESTRICT로 실패**.
3. **`is_demo = true` 행만 하드삭제**한다. 실데이터(특히 paid 인보이스)는 절대 하드삭제 금지. 이벤트 테이블엔 `is_demo`가 없으므로 **데모 도메인 행의 id 집합으로 스코프**(예: `invoice_id in (select id from invoices where is_demo)`).
4. `revalidatePath`로 관련 경로 갱신.

### 2) UI 배선

- 대시보드(`src/app/(dashboard)/dashboard/page.tsx`)의 "데모 데이터 채우기" 버튼을 `seedDemoData`에 배선(비활성 해제). 데이터가 있으면 "데모 데이터 지우기"(`clearDemoData`)를 노출. **지우기는 파괴적** → 확인 UI(`client-delete-button.tsx` 패턴) + 토스트. client 컴포넌트는 최소.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test          # 데모 채우기/지우기 테스트 통과(순서·is_demo 스코프), 기존 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 삽입/삭제가 **RLS 스코프 Supabase 클라이언트**인가(`service_role`·raw pg 아님)?
   - 모든 데모 행이 `is_demo=true`·`user_id=getUser`인가? 스냅샷이 서버 `calcWithholding`인가?
   - 지우기가 **자식→부모 순(FK RESTRICT)**인가? **`is_demo=true`만** 하드삭제하는가(실데이터 안전)?
   - 이벤트 삭제가 데모 도메인 행 id로 스코프되는가?
   - 이벤트 append가 도메인 insert **성공 후**인가?
   - 지우기에 확인 UI가 있는가?
3. `phases/7-dashboard-reports/index.json`의 step 2를 업데이트(성공/실패/blocked). 완료 시 **phase 7 전체 완료**(execute.py가 `phases/index.json`의 `7-dashboard-reports`도 기록).

## 금지사항

- `service_role` 키나 raw pg를 요청 경로에서 쓰지 마라. 이유: CRITICAL — service_role은 CLI 시드 전용. Server Action은 RLS 클라이언트.
- 지우기에서 `is_demo=false`(실데이터)를 삭제하지 마라. 이유: 실제 paid 인보이스 등 영구 손실. `is_demo=true` 스코프 필수.
- 삭제를 부모(clients/contracts)부터 하지 마라. 이유: FK `ON DELETE RESTRICT`로 실패(자식 이벤트/인보이스 먼저).
- `is_demo`를 client 입력으로 받지 마라. 이유: 서버 소유 필드(Server Action 내부에서 서버가 세팅).
- 이벤트 insert를 도메인 insert보다 앞에 두지 마라. 이유: 부분 실패 시 미완.
- 대시보드/CSV 로직을 새로 만들지 마라. 이유: step 0·1 소관(이 step은 데모 데이터만).
- 기존 테스트를 깨뜨리지 마라.

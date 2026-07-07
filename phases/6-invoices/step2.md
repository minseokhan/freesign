# Step 2: payment-toggle

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. 인보이스 상태전이(정산)·이벤트 append 규칙(도메인 UPDATE 후 이벤트 INSERT 순차). `paid_at`은 서버 기록. `overdue`는 파생(상태 아님).
- `/docs/UX_PRINCIPLES.md` — 피드백·낙관적 업데이트·실패 시 롤백+토스트. `/docs/UI_GUIDE.md` — 정산 상태 배지·토글 UI.
- `/CLAUDE.md` — CRITICAL: 쓰기는 Server Action에서만. 서버 소유 필드(`paid_at`·`payment_status`) client 입력 금지. 상태 전이는 **append-only 이벤트 로그에 함께 기록**(도메인 UPDATE 후 이벤트 INSERT, 순차). status 변경을 쓰기 순서 앞쪽에 두지 마라.
- 이전 phase/step 산출물(실제 경로):
  - **상태전이+이벤트 로깅 레퍼런스**(구조 그대로): `src/app/(dashboard)/contracts/actions.ts`의 `transitionContractStatus` — 도메인 조회 → `UPDATE` → `*_events` INSERT(append) → `revalidatePath`. 반환형 `{ok:true,id}` | `{ok:false,error}`.
  - `src/app/(dashboard)/invoices/actions.ts` — step 1에서 만든 발행 액션(같은 파일에 토글 액션 추가). `InvoiceActionResult` 타입 재사용.
  - `src/app/(dashboard)/invoices/[id]/page.tsx`, `src/app/(dashboard)/invoices/page.tsx` — step 0 상세·목록(토글 버튼 배선 지점·`revalidatePath` 대상).
  - `src/components/payment-status-badge.tsx` — step 0 정산 상태 배지.
  - `src/lib/auth.ts` — `requireUser()`. `src/lib/db/index.ts` — `notDeleted`/`assertOwned`. `src/lib/supabase/server.ts` — `createClient()`.
  - `src/types/database.ts` — `invoices` Update(`payment_status`·`paid_at`·`payment_method`), `invoice_events` Insert(`invoice_id`·`from_status`·`to_status`·`event_type`·`actor`·`user_id`·`meta`), `payment_status` enum(`draft|unpaid|paid`).
  - **`useOptimistic` 참고**: client 컴포넌트에서 상태 낙관적 반영 후 서버 실패 시 롤백. `src/components/signature-pad.tsx`·`src/components/client-delete-button.tsx`(client 액션 호출+토스트 패턴).

**배경**: 이 step은 발행된 인보이스의 **정산 상태를 토글**한다(`unpaid` ↔ `paid`, **되돌리기 허용**). 입금 표시는 `paid_at`(서버 시각)·선택적 `payment_method`를 서버가 기록하고, 모든 전이는 `invoice_events`에 append된다. UI는 `useOptimistic`으로 즉시 반영하되 실패 시 롤백+토스트.

## 작업

**TDD: 토글 로직은 `invoices/actions.ts`(로직 소스). 테스트를 먼저 작성/보강하라**(소유권·전이 규칙·`paid_at` 서버 기록·서버 소유 필드 무시·이벤트 append). 레퍼런스: `src/app/(dashboard)/contracts/__tests__/actions.test.ts`.

### 1) 정산 토글 Server Action — `src/app/(dashboard)/invoices/actions.ts`에 추가

시그니처(재량):

```ts
export async function setInvoicePayment(
  id: string,
  toStatus: unknown,          // "paid" | "unpaid" 만 허용(zod enum)
  input?: unknown,            // 선택: { payment_method?: string } 화이트리스트
): Promise<InvoiceActionResult>;
```

**필수 순서와 규칙**:

1. `const user = await requireUser()`.
2. `toStatus`를 zod로 `"paid"|"unpaid"`만 허용(`draft`로의 전이는 이 액션에서 금지 — 발행 후 상태). 유효하지 않으면 거부.
3. 대상 인보이스 조회(`notDeleted`, `maybeSingle`). 없으면 거부(소유권은 RLS+조회로 확인. `assertOwned` 병행 가능).
4. 전이 검증: `unpaid → paid`, `paid → unpaid`만 허용(되돌리기 OK). `from === to`(no-op)는 성공 처리하거나 조기 반환 — 재량이나 **이벤트 중복 append 금지**.
5. **도메인 UPDATE 먼저**: `payment_status = toStatus`. `paid`로 갈 때 `paid_at = new Date().toISOString()`(**서버 시각**)·`payment_method`(입력 화이트리스트 있으면). `unpaid`로 되돌릴 때 `paid_at = null`·`payment_method = null`.
6. **UPDATE 성공 후** `invoice_events` INSERT(append): `event_type: "invoice.payment_changed"`, `from_status`(이전 `payment_status`), `to_status`, `actor: user.id`, `user_id: user.id`, `invoice_id: id`. **이벤트를 UPDATE 앞에 두지 마라**(부분 실패 시 미완 방지).
7. `revalidatePath("/invoices")`, `revalidatePath("/invoices/${id}")`. `{ ok: true, id }`.

**`paid_at`·`payment_method`·`payment_status`는 서버가 기록**한다. client가 `paid_at`을 보내도 무시(입력 스키마에 넣지 마라).

### 2) 토글 UI (client 컴포넌트) — `src/components/invoice-payment-toggle.tsx` 신규

- `"use client"`. **`useOptimistic`**로 현재 `payment_status`를 즉시 토글 반영 → Server Action 호출 → **실패 시 이전 값으로 롤백 + 에러 토스트**, 성공 시 성공 토스트. `useTransition`으로 pending 처리.
- 인보이스 상세(`src/app/(dashboard)/invoices/[id]/page.tsx`)에 버튼 배선(step 0의 placeholder 자리 대체). 목록에서도 토글을 노출할지는 재량이나 **외과적 변경**으로.
- `overdue`(연체)는 여전히 파생 표시 — 토글과 무관하게 `unpaid && due_date < 오늘`로 강조.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test          # 토글 액션 테스트 통과 + 기존 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `payment_status`·`paid_at`·`payment_method`가 **서버에서만** 설정되는가(client 입력 무시)?
   - `unpaid↔paid` **양방향 전이**가 되고, `paid_at`이 `paid`에서 서버 시각·`unpaid`에서 null인가?
   - 이벤트를 **도메인 UPDATE 성공 후**에 append하는가(순서)? no-op에서 이벤트 중복이 없는가?
   - UI가 **`useOptimistic`**으로 즉시 반영하고 **실패 시 롤백+토스트**하는가?
   - `overdue`는 여전히 파생인가(컬럼/상태 아님)?
3. `phases/6-invoices/index.json`의 step 2를 업데이트(성공/실패/blocked).

## 금지사항

- `paid_at`·`payment_status`·`payment_method`를 client 입력으로 받지 마라. 이유: CRITICAL — 서버 소유 필드. 입금일 위변조 방지.
- 이벤트 INSERT를 도메인 UPDATE보다 **앞에** 두지 마라. 이유: 부분 실패 시 실제 상태와 이력 불일치.
- `overdue`를 저장 상태로 만들거나 `payment_status`에 추가하지 마라. 이유: 연체는 파생 값(ROADMAP 핵심 제약).
- 인보이스 금액·원천징수 스냅샷을 토글 시 재계산/변경하지 마라. 이유: 발행 후 고정.
- 낙관적 업데이트 실패 시 롤백을 생략하지 마라. 이유: UI와 서버 상태 불일치(UX_PRINCIPLES).
- 인보이스 PDF를 만들지 마라. 이유: step 3 소관.
- 기존 테스트를 깨뜨리지 마라.

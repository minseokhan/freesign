# Step 1: invoice-create

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. 쓰기는 Server Action에서만(`revalidatePath`). invoices 모델·**FK 소유권 재검증**(invoice→contract/client는 Server Action에서 소유권 재조회 후 insert, FK는 RLS 우회) · **발행 시점 원천징수 스냅샷**.
- `/docs/ADR.md` — ADR-003(원천징수 계산·스냅샷). `/docs/PRD.md` — 인보이스 발행(기능). `/docs/UI_GUIDE.md` — 원천징수 점진적 노출·발행 폼.
- `/CLAUDE.md` — CRITICAL: Server Action은 **client 입력 전용 zod allowlist(도메인 필드만)**만 받고, `user_id`는 항상 `getUser()`(=`requireUser()`)에서, **서버 소유 필드(금액 스냅샷·`paid_at`·`payment_status`)는 client 입력 금지**. FK 참조(invoice→contract/client)는 Server Action에서 **소유권 재조회 검증 후 insert**(FK는 RLS 우회).
- 이전 phase 산출물(실제 경로 — 패턴을 그대로 따라라):
  - **Server Action 레퍼런스**(구조 그대로): `src/app/(dashboard)/contracts/actions.ts` — `requireUser()` → zod `safeParse` → `assertOwned` FK 소유권 재조회 → insert → `revalidatePath`, `ContractActionResult`(`{ok:true,id}` | `{ok:false,error,fieldErrors?}`) 반환 형태.
  - **zod allowlist 레퍼런스**: `src/lib/validation/contract.ts`, `src/lib/validation/client.ts`(도메인 필드만·서버 소유 필드 제외).
  - `src/lib/tax.ts` — `calcWithholding(amount, type): { incomeTax, localTax, withholding, net }`, `WithholdingType = "wt_3_3"|"wt_8_8"|"none"`. **발행 스냅샷 계산에 이걸 쓴다.**
  - `src/lib/db/index.ts` — `assertOwned(supabase, table, id)`(소유 여부 boolean), `notDeleted`.
  - `src/lib/auth.ts` — `requireUser()`. `src/lib/supabase/server.ts` — `createClient()`.
  - `src/types/database.ts` — `invoices` Insert/Row(필수: `amount`·`client_id`·`contract_id`·`issue_date`·`due_date`·`net_amount`·`withholding_amount`·`withholding_type`·`user_id`. 서버 기본: `payment_status`·`paid_at`), `payment_status`/`withholding_type` enum.
  - `src/app/(dashboard)/contracts/[id]/page.tsx` — 발행 진입점(계약 상세에 "인보이스 발행" 링크/버튼을 배선).
  - `src/app/(dashboard)/invoices/page.tsx`, `src/app/(dashboard)/invoices/[id]/page.tsx` — step 0 목록·상세(발행 후 `revalidatePath` 대상).

**배경**: 이 step은 **계약(contract) 아래 인보이스를 발행**한다(계약 1:N 인보이스). 발행 순간 **원천징수·금액이 고정 스냅샷**이 된다(세율이 나중에 바뀌어도 과거 인보이스는 불변). FK(`contract_id`·`client_id`)는 RLS를 우회하므로 **Server Action에서 소유권을 반드시 재검증**한 뒤 insert한다.

## 작업

**TDD: `src/app/(dashboard)/invoices/actions.ts`는 로직 소스다. 테스트를 먼저 작성하라**(소유권 위반 차단·스냅샷 값·서버 소유 필드 무시). 레퍼런스: `src/app/(dashboard)/contracts/__tests__/actions.test.ts`.

### 1) zod allowlist — `src/lib/validation/invoice.ts` 신규

- **client 입력 전용 도메인 필드만** 허용: `contract_id`(uuid), `amount`(양의 정수, `> 0`), `issue_date`·`due_date`(날짜 문자열, **`due_date >= issue_date`** refine), `withholding_type`(`wt_3_3|wt_8_8|none`). `client_id`는 **입력받지 마라**(계약에서 파생).
- **금지 필드**: `net_amount`·`withholding_amount`·`payment_status`·`paid_at`·`payment_method`·`user_id`·`is_demo` — 스키마에 넣지 마라(서버 계산/소유).

### 2) 발행 Server Action — `src/app/(dashboard)/invoices/actions.ts` 신규

시그니처(재량이나 반환형은 contracts 패턴을 따라라):

```ts
export type InvoiceActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string; fieldErrors?: Partial<Record<string, string[]>> };

export async function createInvoice(input: unknown): Promise<InvoiceActionResult>;
```

**필수 순서와 규칙**:

1. `const user = await requireUser()` — `user_id`는 **항상 여기서**.
2. zod `safeParse`(위 allowlist). 실패 시 `fieldErrors` 반환.
3. **FK 소유권 재검증**: `assertOwned(supabase, "contracts", contract_id)`. 소유 아니면 발행 거부. 그리고 계약을 재조회(`notDeleted`)해 **`client_id`를 계약에서 가져온다**(client 입력 신뢰 금지). 계약이 발행 가능한 상태인지(예: `canceled` 계약엔 발행 금지) 확인은 재량이나 최소 존재·소유·미삭제는 필수.
4. **원천징수 스냅샷 계산**: `const { withholding, net } = calcWithholding(amount, withholding_type)`. `withholding_amount = withholding`, `net_amount = net`로 **서버에서 채운다**. client가 보낸 값이 있어도 무시.
5. insert payload = `{ user_id: user.id, contract_id, client_id(계약에서), amount, issue_date, due_date, withholding_type, withholding_amount, net_amount }`. `payment_status`는 **서버 기본값/명시**(발행 = 미수: `unpaid`. `draft` enum은 존재하나 이 발행 액션은 `unpaid`로 확정 — 초안 편집은 이 phase 스코프 밖). `paid_at`은 넣지 마라(null).
6. insert 후 `revalidatePath("/invoices")`, `revalidatePath("/contracts/${contract_id}")`(계약 상세의 하위 인보이스 갱신), 필요 시 `revalidatePath("/invoices/${id}")`. `{ ok: true, id }` 반환.

**이벤트 로그**: 발행을 이력에 남기려면 도메인 insert **성공 후** `invoice_events`에 append(`event_type: "invoice.created"`, `to_status: "unpaid"`, `from_status: null`, `actor: user.id`, `user_id: user.id`, `invoice_id`). 순서: **도메인 insert → 이벤트 insert**(이벤트를 앞에 두지 마라 — 부분 실패 시 미완 방지). 레퍼런스: `contracts/actions.ts`의 `transitionContractStatus` 이벤트 append.

### 3) 발행 폼 UI

- 계약 상세(`src/app/(dashboard)/contracts/[id]/page.tsx`)에 발행 진입점을 배선하고, react-hook-form + zod(위와 **동일 스키마로 클라이언트 검증**, 서버에서 재검증) 폼을 만든다(예: `src/components/invoice-form.tsx`, 라우트는 `/invoices/new?contract=...` 또는 계약 상세 인라인 — 재량). `withholding_type` select, `amount`·`issue_date`·`due_date` 입력. **실수령액(net) 미리보기**는 클라이언트에서 `calcWithholding`로 보여주되, **저장 값은 서버 스냅샷이 진실**(미리보기는 표시용).
- 폼 컴포넌트/프리미티브 레퍼런스: `src/components/contract-form.tsx`, `src/components/client-form.tsx`.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test          # 신규 actions 테스트 통과 + 기존 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `user_id`가 **`requireUser()`**에서만 오는가(client 입력 아님)?
   - zod allowlist가 **도메인 필드만** 받고 `net_amount`/`withholding_amount`/`payment_status`/`paid_at`을 **거부**하는가?
   - FK(`contract_id`)를 **`assertOwned`로 소유권 재검증** 후 insert하는가? `client_id`를 **계약에서 파생**(client 입력 무시)하는가?
   - `withholding_amount`·`net_amount`가 **서버 `calcWithholding` 스냅샷**으로 채워지는가?
   - 이벤트를 **도메인 insert 성공 후**에 append하는가(순서)?
   - `revalidatePath`로 `/invoices`·계약 상세가 갱신되는가?
3. `phases/6-invoices/index.json`의 step 1을 업데이트(성공/실패/blocked).

## 금지사항

- `user_id`·`net_amount`·`withholding_amount`·`payment_status`·`paid_at`을 client 입력으로 받지 마라. 이유: CRITICAL — 서버 소유 필드. client 입력 시 위변조.
- `client_id`를 client 입력으로 신뢰하지 마라. 이유: 계약과 불일치·타 소유 client 연결 가능. 계약에서 재조회로 파생하라.
- FK insert 전에 소유권 재검증을 생략하지 마라. 이유: CRITICAL — FK는 RLS를 우회하므로 타 user의 contract에 인보이스를 붙일 수 있다.
- 이벤트 insert를 도메인 insert보다 **앞에** 두지 마라. 이유: 부분 실패 시 도메인 없는 이벤트가 남는다.
- 정산 토글(paid 처리)·PDF를 만들지 마라. 이유: step 2·3 소관.
- 발행된 인보이스의 스냅샷(금액·원천징수)을 재계산해 덮어쓰지 마라. 이유: 발행 후 고정(ROADMAP 핵심 제약).
- 기존 테스트를 깨뜨리지 마라.

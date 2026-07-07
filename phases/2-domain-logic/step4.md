# Step 4: payment-provider

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-003**(Provider 어댑터로 서명·결제 우회, v1 → v2 교체 지점): 결제는 `services/payment`의 `PaymentProvider` 인터페이스 뒤에 둔다. v1은 **수동 상태 토글**. **ADR-006**(정산은 상태 머신 + append-only 이벤트 로그): `payment_status`(draft→unpaid→paid, **되돌리기 허용**) 수동 토글, 모든 상태 전이는 이벤트 로그에 기록. overdue는 파생(상태 아님)
- `/docs/ARCHITECTURE.md` — "상태 전이 머신"(payment_status 전이·되돌리기), "데이터 흐름"의 **쓰기**(도메인 UPDATE → 이벤트 INSERT 순차), 데이터 모델 `invoices.payment_status`/`paid_at`
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: 결제는 `services/`의 **v1 전용 Provider 인터페이스** 뒤로만 접근. 상태 전이는 append-only 이벤트 로그에 함께 기록(**도메인 UPDATE 후 이벤트 INSERT 순차**, status 변경을 쓰기 순서 앞쪽에 두지 말 것)
- phase 1 산출물: `src/types/database.ts` — enum `payment_status`(값 확인: 예 `draft` | `unpaid` | `paid`), `invoices.paid_at`/`method` 컬럼 shape
- phase 2 step 3 산출물: `src/services/signature/`(Provider 인터페이스 분리 패턴의 레퍼런스 — 같은 방식으로 payment도 인터페이스 뒤에)

**배경**: 이 step은 정산의 **v2 교체 지점**인 `PaymentProvider` 인터페이스와, v1의 **수동 상태 전이 규칙**(허용/금지 전이·되돌리기)을 순수 로직으로 만든다. 실제 DB UPDATE·이벤트 INSERT·`useOptimistic` UI·토글 Server Action은 **phase 6(payment-toggle)** 소관이며 여기서 만들지 않는다. 여기서 만드는 건 "현재 상태 + 액션 → (검증된) 다음 상태·기록할 필드"를 계산하는 결정적 로직이다.

## 작업

`src/services/payment/`에 `PaymentProvider` 인터페이스와 v1 어댑터를 만든다.

`.codex` TDD 가드가 `services/*.ts`를 테스트 없이 차단한다. **테스트를 먼저 작성**하라(`src/services/payment/__tests__/*.test.ts`). 순수 인터페이스(타입)만 담는 파일이 필요하면 `src/types/`에 둘 수 있으나(가드 예외), 전이 로직은 반드시 테스트 동반.

### 핵심 규칙 (반드시 지켜라)

- **v1은 수동 상태 토글**(실 PG 연동 없음). 허용 전이: `unpaid ↔ paid`(되돌리기 허용). `draft`는 발행 전 상태(발행 시 `unpaid`로). 전이 표를 코드로 못박고, **허용되지 않은 전이는 거부**(throw 또는 결과에 오류 표시)하라.
- **`paid_at`·`method`는 서버 기록 필드**다. 이 로직은 "paid로 전이 시 `paid_at`을 채우고 unpaid로 되돌리면 `paid_at`을 비운다" 같은 **전이에 따른 필드 변화**를 계산해 반환한다. 단, **실제 시각 값(`new Date()`)을 이 순수 로직 안에서 만들지 마라** — `paidAt`을 인자로 주입받거나 "채워야 함" 플래그만 반환하고, 실제 타임스탬프·DB write는 phase 6 Server Action이 넣는다(하네스에서 `Date.now()` 금지·재현성).
- **overdue는 상태가 아니다**(파생). `payment_status` enum에 넣거나 전이 대상으로 삼지 마라(파생 표시는 step 1 `deriveDueStatus`가 담당).
- **이벤트 로그·DB UPDATE는 여기서 하지 마라**(phase 6). 이 로직은 순수하게 "다음 상태·기록 필드"만 산출하고, "도메인 UPDATE 후 이벤트 INSERT 순차" 배선은 phase 6이 한다.

### 시그니처(예시 — 정확한 형태는 재량)

```ts
export type PaymentStatus = "draft" | "unpaid" | "paid"; // database.ts enum과 일치

export interface PaymentTransition {
  next: PaymentStatus;
  setPaidAt: boolean;    // paid로 전이 → true(실제 시각은 phase 6이 주입), 되돌리기 → false(clear)
  // method 등 전이에 수반되는 서버 기록 필드 변화
}

// v2 교체 지점. v1/v2 공통 계약.
export interface PaymentProvider {
  // 현재 상태에서 액션 적용 → 검증된 다음 전이. 허용 안 되면 거부.
  applyTransition(current: PaymentStatus, action: "mark_paid" | "mark_unpaid"): PaymentTransition;
}

export function createV1PaymentProvider(): PaymentProvider;
```

`PaymentStatus` 리터럴 값은 `database.ts`의 `payment_status` enum과 정확히 일치해야 한다(먼저 확인하고 어긋나면 enum 값을 따르라).

### 테스트 (먼저 작성)

- **허용 전이**: `unpaid --mark_paid--> paid`(`setPaidAt: true`), `paid --mark_unpaid--> unpaid`(`setPaidAt: false`, paid_at clear 의미).
- **되돌리기**: paid → unpaid가 허용되는가(ADR-006: 되돌리기 허용).
- **금지 전이**: 정의하지 않은 전이(예: `paid --mark_paid-->` 동일 상태 재적용, `draft`에서의 부적절한 액션)를 거부하는가.
- **순수성/재현성**: 같은 (current, action) → 항상 같은 결과. 내부에서 `new Date()`를 부르지 않는가.
- **enum 정합**: 반환 상태가 `payment_status` enum 값과 일치하는가.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test    # payment 서비스 단위테스트(테스트 먼저) + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 전이 표가 코드로 못박혔고, 되돌리기(`paid → unpaid`)가 허용되며, 미정의 전이는 거부되는가?
   - `paid_at`·`method` 같은 서버 필드를 **실제 값 생성 없이**(플래그/주입) 다루는가(내부 `new Date()` 없음)?
   - overdue를 상태로 취급하지 않았는가(파생)?
   - DB UPDATE·이벤트 INSERT를 여기서 하지 않았는가(phase 6로 남겼는가)?
   - `PaymentProvider`가 v2 교체 지점 인터페이스로 분리됐는가? `PaymentStatus`가 enum과 일치하는가?
   - 테스트가 먼저 작성됐는가(TDD)?
3. `phases/2-domain-logic/index.json`의 step 4를 업데이트(성공 `completed`+summary / 3회 실패 `error` / 개입 필요 `blocked`). 이 step 완료 시 **phase 2 전체 완료** — `index.json`에 phase 완료 표식이 필요하면 함께 정리.

## 금지사항

- 토글 Server Action·`useOptimistic` UI·DB UPDATE·이벤트 INSERT를 만들지 마라. 이유: phase 6(payment-toggle) 소관. "도메인 UPDATE 후 이벤트 INSERT 순차" 배선도 phase 6이 한다.
- `new Date()`/`Date.now()`로 `paid_at`을 이 로직 안에서 채우지 마라. 이유: 순수성·재현성 상실, 하네스 금지. 실제 시각은 phase 6 Server Action이 주입한다.
- overdue를 `payment_status`에 넣거나 전이 대상으로 삼지 마라. 이유: overdue는 due_date 기반 파생(step 1 `deriveDueStatus`)이지 저장 상태가 아니다.
- v1을 실 PG(결제대행)처럼 과설계하지 마라(웹훅·비동기·리다이렉트). 이유: ADR-003 — v1은 수동 상태 재현까지, 실 PG는 v2 재설계 대상.
- 기존 테스트를 깨뜨리지 마라.

# Step 0: tax

## 읽어야 할 파일

먼저 아래를 읽고 원천징수 계산의 규칙·저장 위치를 파악하라:

- `/docs/ARCHITECTURE.md` — "데이터 모델 규칙"의 **원천징수 계산**(`lib/tax.ts`: 소득세 **원 미만 절사** + 지방소득세 **10원 미만 절사** 분리, 발행 시점 스냅샷 저장·drift 방지, draft 동안만 재계산), "DB CHECK 제약"(`amount > 0`, `0 <= withholding_amount <= amount`, `net_amount >= 0`)
- `/docs/ADR.md` — ADR-006(원천징수·금액은 발행 시점 스냅샷)
- `/docs/PRD.md` — "원천징수는 참고용 계산·기록·내보내기까지만(세무사법 준수)", 면책 반복 노출
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: `lib/tax.ts` 순수 함수는 **TDD 필수**(경계값·절사), 집계는 SQL·변환만 JS
- phase 1 산출물: `src/types/database.ts` — enum `withholding_type`(`wt_3_3` | `wt_8_8` | `none`), `invoices.amount`/`withholding_amount`/`net_amount`(bigint → number) 컬럼 shape. 이 함수의 반환이 그 컬럼 스냅샷에 그대로 들어간다.

**배경**: 이 phase는 계산·변환 순수 함수와 v1 Provider 어댑터를 만드는 **TDD 집중 phase**다. 이 step은 그 첫 순수 함수 — 원천징수 계산 — 만 만든다. 인보이스 발행·저장(스냅샷 write)은 phase 6 소관이며 여기서 만들지 않는다. 여기서 만드는 함수가 **phase 6이 발행 시점에 호출해 스냅샷을 굳히는** 단일 계산 소스다.

## 작업

`src/lib/tax.ts` 원천징수 계산 순수 함수를 만든다. **`lib/` 로직이므로 TDD 대상 — 테스트를 먼저 작성**하라(`src/lib/__tests__/tax.test.ts`).

### 도메인 규칙 (반드시 이대로 구현)

원천징수율은 `withholding_type` enum으로 결정한다:

- `wt_3_3` → **3.3%** = 소득세 3% + 지방소득세 0.3%
- `wt_8_8` → **8.8%** = 소득세 8% + 지방소득세 0.8%
- `none` → 0 (원천징수 없음)

**지방소득세는 소득세의 10%**로 정의한다(3%→0.3%, 8%→0.8%가 이 관계로 성립). 즉 소득세를 먼저 구하고 지방소득세는 그 10%로 산출하라 — 총액에 3.3%를 한 번에 곱하지 마라(절사 단계가 세목별로 다르다).

**절사 규칙(핵심 — 순서대로)**:
1. 소득세 = `amount × 소득세율`을 계산한 뒤 **원 미만 절사**(1원 단위로 floor).
2. 지방소득세 = `소득세 × 0.1`을 계산한 뒤 **10원 미만 절사**(10원 단위로 floor).
3. `withholding_amount` = 소득세 + 지방소득세.
4. `net_amount` = `amount − withholding_amount`.

절사는 반올림·올림이 아니라 **버림(floor)**이다. 금액은 모두 정수 원(bigint 컬럼 대응 → JS `number` 정수)으로 다룬다. 부동소수 오차를 남기지 마라(예: `Math.floor` 전에 정수 연산으로 유도하거나 `Math.floor(amount * 3 / 100)` 형태로).

### 시그니처(예시 — 정확한 형태·내부 구현은 재량)

```ts
export type WithholdingType = "wt_3_3" | "wt_8_8" | "none";

export interface WithholdingBreakdown {
  incomeTax: number;      // 소득세 (원 미만 절사)
  localTax: number;       // 지방소득세 (10원 미만 절사)
  withholding: number;    // = incomeTax + localTax  → invoices.withholding_amount 스냅샷
  net: number;            // = amount - withholding   → invoices.net_amount 스냅샷
}

export function calcWithholding(amount: number, type: WithholdingType): WithholdingBreakdown;
```

세목을 분리 반환하는 이유: 인보이스 상세 화면이 **소득세/지방소득세 내역을 나눠 표시**하고(phase 6·UI_GUIDE 원천징수 점진적 노출), PDF에도 세목이 들어간다. 합계만 반환하면 상위에서 재계산해야 해 drift가 생긴다.

`WithholdingType`은 `database.ts`의 생성 enum과 값이 일치해야 한다(문자열 리터럴 동일). 별도 정의하되 값이 어긋나지 않게 하라.

### 테스트 (먼저 작성)

- **`none`**: 어떤 amount든 `withholding=0`, `net=amount`.
- **`wt_3_3` 기본**: 예) `amount=1,000,000` → 소득세 30,000, 지방소득세 3,000, withholding 33,000, net 967,000.
- **`wt_8_8` 기본**: 예) `amount=1,000,000` → 소득세 80,000, 지방소득세 8,000, withholding 88,000, net 912,000.
- **절사 경계값(핵심)**: 딱 나눠떨어지지 않는 금액으로 세목별 절사가 실제로 일어나는 케이스. 예) `wt_3_3`에서 소득세에 원 미만이 생기는 amount, 지방소득세에 10원 미만이 생기는 amount를 각각 최소 1개씩. 절사가 **버림**임을 못박는 값(반올림이면 틀리는 값)을 골라라.
- **CHECK 제약 정합성**: 유효한 입력(`amount > 0`)에 대해 항상 `0 <= withholding <= amount`, `net >= 0`이 성립하는지. 이 함수 결과가 DB CHECK를 위반하면 phase 6 insert가 실패한다.
- **`amount=0` 또는 음수**: 정책을 정하고(예: `amount <= 0`이면 throw 또는 0 반환) 테스트로 고정하라. DB는 `amount > 0`을 요구하므로 0/음수는 정상 경로가 아니다 — 방어적으로 처리하되 근거를 주석에 남겨라.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test    # tax 단위테스트(테스트 먼저) + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 소득세(원 미만)·지방소득세(10원 미만) **절사 단위가 세목별로 다르게** 적용됐는가? 한 번에 3.3%를 곱하지 않았는가?
   - 절사가 **floor(버림)**인가(반올림 아님)?
   - 유효 입력에서 `0 <= withholding <= amount`·`net >= 0`이 항상 성립하는가(CHECK 정합)?
   - `WithholdingType` 값이 `database.ts` enum과 일치하는가?
   - 테스트가 먼저 작성됐는가(TDD)?
3. `phases/2-domain-logic/index.json`의 step 0을 업데이트:
   - 성공 → `"status": "completed"` + `"summary"`(파일 경로·공개 함수/타입 요약)
   - 3회 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"`

## 금지사항

- 인보이스 발행·DB write·스냅샷 저장 로직을 만들지 마라. 이유: phase 6 소관. 이 step은 순수 계산 함수만이다.
- 한 번에 총 세율(3.3%/8.8%)을 곱해 절사하지 마라. 이유: 소득세(원)·지방소득세(10원) 절사 단위가 달라 세목별 합산과 결과가 어긋난다.
- 반올림·올림을 쓰지 마라. 이유: 원천징수 절사는 버림이다.
- `Date`·환경·랜덤 등 부수효과를 함수에 넣지 마라. 이유: 순수 함수여야 스냅샷 재현·테스트가 가능하다.
- UI·포맷팅(₩ 기호·천단위 콤마)을 여기 넣지 마라. 이유: 표시 변환은 step 1(`lib/metrics.ts`) 소관. 여기선 정수 원 값만 계산한다.
- 기존 테스트를 깨뜨리지 마라.

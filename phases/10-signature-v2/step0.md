# Step 0: signing-domain

쌍방 전자서명 v2의 도메인 기반: 서명 토큰 순수 함수, `sent` 상태 전이, `legalEffect` 재정의. **DB·UI·API는 이 step 범위가 아니다.**

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/SIGNATURE_V2_PLAN.md` — §2 핵심 설계 결정(상태 머신·서명 순서·토큰·legalEffect 행), §3 Step 1
- `/docs/LEGAL_SIGNATURE.md` — legalEffect가 "none"에서 입증력 단계 표현으로 바뀌는 배경(§전자서명법 부분)
- `src/lib/contract-status.ts` — 현재 전이 매트릭스와 `getContractStatusTransition` 시그니처
- `src/services/signature/provider.ts` — `V1SignatureResult.legalEffect: "none"` 현재 정의
- `src/app/api/contracts/[id]/sign/route.ts` 및 `src/app/api/contracts/[id]/sign/__tests__/route.test.ts` — `legalEffect` 참조처(응답·이벤트 meta)
- `src/lib/__tests__/` 하위의 contract-status 관련 기존 테스트 — 테스트 파일 위치·스타일 관례

`legalEffect`를 grep(`grep -rn "legalEffect" src`)해서 참조처를 전부 찾은 뒤 작업하라. UI 문구에 "효력 없음" 류 표현이 있으면 함께 갱신 대상이다.

## 작업

### 1) 신규 `src/lib/signing-token.ts` (server-only)

```ts
// server-only 주석 필수 (기존 provider.ts 상단 스타일 참고)
export function generateSigningToken(): string;  // crypto.randomBytes(32) → base64url
export function hashSigningToken(token: string): string;  // sha256 hex
```

- 원문 토큰은 발송 순간에만 존재하고 DB엔 해시만 저장된다는 전제의 기반 함수다. `node:crypto`만 사용, 외부 의존성 금지.

### 2) 수정 `src/lib/contract-status.ts`

- enum에 `sent` 추가를 전제로 전이 매트릭스 확장 (`ContractStatus` 타입은 `Database` 생성 타입에서 오므로, 이 step에서는 `CONTRACT_STATUSES` 배열과 매트릭스에 `"sent"`를 추가하되 타입 에러가 나면 로컬 union으로 우회하지 말고 `Database["public"]["Enums"]["contract_status"]`에 `"sent"`가 없는 동안은 캐스팅 최소화로 처리 — step 1에서 타입 재생성되면 캐스팅 제거 가능하도록 TODO 주석):
  - `draft → [signed, sent, canceled]`
  - `sent → [signed, draft, canceled]`
  - 기존 `signed/active` 전이는 그대로 보존
- 시그니처 확장: `getContractStatusTransition(from, to, ctx?: { hasCounterpartySignature?: boolean })`
  - `ctx.hasCounterpartySignature === true`이면 `to === "draft"` 전이를 **차단**(allowed: false). 이유: 상대 서명은 불변 증거 — signed→draft 리셋 금지 (LEGAL_SIGNATURE.md:100 경고).
  - `sent → draft`는 서명 아티팩트 리셋 플래그(`resetSignatureArtifacts: true`)를 유지해야 한다(발송 철회 시 owner 서명·해시 리셋).
- `sent`·`signed` **진입**은 일반 사용자 전이 입력에서 거부되어야 한다: `getAvailableContractStatusTransitions(from)`이 UI 셀렉트에 쓰이므로, 이 함수 결과에서 `sent`를 제외하는 별도 처리(또는 옵션 파라미터)를 추가하라. `draft → signed`(단독 서명)·`draft → sent`(발송)는 전용 절차(서명 route·발송 액션)에서만 일어난다. 기존 단독 서명 경로가 사용하는 함수 호출을 깨뜨리지 마라.

### 3) 수정 `src/services/signature/provider.ts`

- `legalEffect: "none"` → `"record" | "mutual"` 로 타입 전환.
  - `createSignatureResult`(owner 단독 서명)는 `"record"` 반환.
  - `"mutual"`은 맞서명 완결 시 사용될 값으로 타입에만 존재(이 step에서 생성 로직 불필요).
- `grep -rn "legalEffect" src` 로 찾은 모든 참조처(sign route 응답, 이벤트 meta, 테스트 기대값, UI 문구)를 `"record"` 기준으로 일괄 갱신하라.

## TDD (테스트 먼저 작성)

기존 테스트 파일 위치 관례를 따라:

1. **전이 매트릭스**: `draft→sent` 허용, `sent→signed`/`sent→draft`/`sent→canceled` 허용, `sent→active` 차단, `active→sent` 차단
2. **ctx 가드**: `hasCounterpartySignature: true`일 때 `signed→draft`·`sent→draft` 차단, false/미지정이면 기존 동작 유지
3. **리셋 플래그**: `sent→draft` 허용 시 `resetSignatureArtifacts === true`
4. **가용 전이 목록**: 사용자 노출용 목록에 `sent` 진입이 포함되지 않음
5. **토큰**: `generateSigningToken()` 결과가 base64url 문자셋·충분한 길이(43자)·호출마다 상이, `hashSigningToken` 이 같은 입력에 결정적이며 64자 hex

## Acceptance Criteria

```bash
npm run lint
npm test        # 신규 테스트 포함 green, 기존 sign route 테스트도 green
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `signing-token.ts`가 server-only이고 클라이언트 컴포넌트에서 import되지 않는가?
   - `legalEffect: "none"` 참조가 코드베이스에 남아 있지 않은가? (`grep -rn '"none"' src` 로 확인)
   - CLAUDE.md CRITICAL 규칙(서버 전용 모듈 경계)을 위반하지 않았는가?
3. 결과에 따라 `phases/10-signature-v2/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 3회 시도 후 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- DB 마이그레이션 파일을 만들지 마라. 이유: step 1 소관. 이 step은 순수 함수·타입만.
- Server Action·API 라우트·UI 컴포넌트를 만들지 마라. 이유: step 5~8 소관.
- 외부 토큰/암호화 라이브러리를 추가하지 마라. 이유: `node:crypto`로 충분.
- 기존 `draft→signed` 단독 서명 전이를 제거하거나 조건을 추가하지 마라. 이유: v1 경로는 그대로 보존이 확정 결정.
- 기존 테스트를 깨뜨리지 마라 (legalEffect 기대값 갱신은 예외 — "none"→"record" 치환은 이 step의 작업이다).

# Step 4: timestamp-provider

RFC 3161 타임스탬프(TSA) 어댑터: `services/timestamp/` 신설. "운영자가 해시를 나중에 조작하지 않았다"를 제3자 서명 토큰(TST)으로 증명하는 모듈. **스탬프를 호출하는 액션·라우트는 이 step 범위가 아니다.**

## 읽어야 할 파일

- `/docs/SIGNATURE_V2_PLAN.md` — §2 TSA 행, §3 Step 4(DER 수동 조립·granted 확인·원문 저장), §4 리스크 4(무료 공용 TSA 한계)
- `/docs/ADR.md` — ADR-003 provider 어댑터 패턴
- `src/services/email/provider.ts` — step 3이 만든 어댑터 스타일(팩토리·폴백·fetchFn 주입) 미러링
- `src/lib/env.ts` — step 3이 수정한 optional env 스키마 스타일

RFC 3161 TimeStampReq의 정확한 DER 인코딩이 불확실하면 웹 검색이나 RFC 3161 §2.4.1을 참조해 SHA-256용 고정 바이트 시퀀스를 확인하라.

## 작업

### 1) 신규 `src/services/timestamp/provider.ts` (server-only)

```ts
export interface TimestampResult { token: string; tsaUrl: string; stampedAt: string; } // token = TST 응답 원문 base64
export interface TimestampProvider { stamp(sha256Hex: string): Promise<TimestampResult | null>; }

export function buildTimeStampReq(sha256Hex: string, nonce: Uint8Array): Uint8Array; // 테스트 가능하게 export
export function createRfc3161TimestampProvider(url: string, fetchFn?: typeof fetch): TimestampProvider;
export function createNoopTimestampProvider(): TimestampProvider; // 항상 null
export function getTimestampProvider(): TimestampProvider;
```

- **TimeStampReq DER 수동 조립** — 외부 ASN.1 라이브러리 의존 없이: SHA-256 AlgorithmIdentifier를 포함한 고정 프리픽스 바이트 + 해시 32바이트 + nonce(INTEGER) + `certReq=true`. 전체 SEQUENCE 길이 필드는 구성 요소 길이에서 계산. `buildTimeStampReq`를 순수 함수로 분리해 golden bytes 테스트가 가능해야 한다.
- 전송: `POST`, `Content-Type: application/timestamp-query`, body는 DER bytes. 응답(TimeStampResp)에서 **status가 granted(0)/grantedWithMods(1)인지 최소 확인**만 하고(DER 첫 부분의 PKIStatusInfo 파싱), 통과 시 **응답 전체 원문을 base64로 저장**. 토큰 심층 파싱 금지 — 검증은 `openssl ts -verify`로 한다는 주석을 남겨라.
- **어떤 실패(네트워크·비2xx·granted 아님·타임아웃)에도 throw 없이 null 반환** + 서버 콘솔 로깅. 이유: 스탬프는 best-effort — 서명 플로우를 차단하면 안 된다(AI 폴백과 동일 철학).
- fetch에 타임아웃(예: AbortSignal.timeout 5초)을 걸어라. 이유: 공용 TSA 다운 시 서명 응답 지연 방지.
- `getTimestampProvider()`: `TSA_URL` env가 있으면 RFC 3161 provider(기본값 `https://freetsa.org/tsr`은 env 스키마 default로), 명시적으로 비활성이거나 테스트 환경이면 noop. dev에서 외부 호출을 피하려면 `TSA_URL` 미설정 시 noop이 되도록 하라 — 즉 default URL은 문서화하되 자동 적용하지 말고, env 없음 = noop.

### 2) 수정 `src/lib/env.ts`

- `TSA_URL` optional 추가.

## TDD (테스트 먼저 작성)

`src/services/timestamp/__tests__/provider.test.ts`:

1. `buildTimeStampReq` golden bytes: 고정 해시·고정 nonce 입력의 출력 바이트에서 프리픽스·해시 삽입 위치·nonce 위치 검증
2. granted 응답(mock) → token base64·tsaUrl 반환
3. status 거부 응답 → null
4. fetch reject/비2xx → null (throw 아님)
5. noop provider → null, env 없음 팩토리 분기 → noop

## Acceptance Criteria

```bash
npm run lint
npm test
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - ASN.1/RFC3161 외부 라이브러리가 package.json에 추가되지 않았는가?
   - `stamp`이 어떤 입력·실패에서도 throw하지 않는가?
   - server-only 경계를 지키는가?
3. 결과에 따라 `phases/10-signature-v2/index.json`의 step 4를 업데이트한다 (성공: completed+summary / 3회 실패: error+error_message / 개입 필요: blocked+blocked_reason 후 중단).

## 금지사항

- ASN.1·pkijs 등 외부 라이브러리를 추가하지 마라. 이유: SHA-256 단일 케이스는 고정 프리픽스 수동 조립로 충분 — 의존성 최소화가 확정 결정.
- TST 토큰을 심층 파싱·검증하는 코드를 만들지 마라. 이유: 저장은 원문 보존, 검증은 `openssl ts -verify` 외부 절차로 문서화가 확정 결정.
- 실 TSA 서버로 테스트하지 마라. 이유: 유닛 테스트는 mock으로, 실스탬프 검증은 phase 완료 후 사용자 수동 절차.
- 스탬프 실패를 에러로 전파하지 마라. 이유: best-effort — 토큰 없는 계약도 유효(완결증명서에 "미확보" 명시는 step 7).
- 기존 테스트를 깨뜨리지 마라.

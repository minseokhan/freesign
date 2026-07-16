# Step 5: send-action

owner의 발송 플로우 Server Actions: "서명하고 요청 보내기"·재발송·철회. **UI 컴포넌트는 이 step 범위가 아니다(step 6 소관).**

## 읽어야 할 파일

- `/docs/SIGNATURE_V2_PLAN.md` — §2(서명 순서·토큰 행), §3 Step 5
- `/CLAUDE.md` — Server Action 규칙: client 입력 전용 zod allowlist, user_id는 getUser()에서, 서버 소유 필드 client 입력 금지, FK 소유권 재조회
- `src/app/(dashboard)/contracts/actions.ts` — 기존 액션 스타일(requireUser·zod·에러 처리·revalidatePath·posthog)
- `src/app/api/contracts/[id]/sign/route.ts` — 기존 owner 단독 서명 플로우: signatureDataUrl PNG regex 검증, Storage 업로드 경로 `${user.id}/${contractId}/signature.png`, computeDocHash, 이벤트 meta. **발송 액션의 owner 서명 처리는 이 route와 일치해야 한다.**
- `src/lib/rate-limit.ts` — `checkRateLimit`·`RATE_LIMITS` 사용법
- 이전 step 산출물: `src/lib/signing-token.ts`, `supabase/migrations/0019_signature_rpcs.sql`(RPC 시그니처), `src/services/email/`(provider·templates), `src/services/timestamp/provider.ts`, `src/types/database.ts`(Functions 타입)
- 기존 액션 테스트(`src/app/(dashboard)/contracts/__tests__/` 또는 인접) — mock 패턴

## 작업

`src/app/(dashboard)/contracts/actions.ts` 또는 인접 신규 파일(기존 파일이 크면 `signature-actions.ts` 분리 허용)에 Server Action 3종:

### 1) `sendSignatureRequest`

zod allowlist (이 필드 외 어떤 입력도 받지 마라):
```ts
{
  contractId: uuid,
  recipientEmail: email(길이 상한),
  recipientName: string optional(길이 상한),
  signatureDataUrl: 기존 sign route와 동일한 PNG data URL regex·크기 제한,
  consentElectronicSignature: z.literal(true),
  consentPrivacy: z.literal(true),
}
```

흐름(순서 준수):
1. `requireUser()` → zod parse
2. `checkRateLimit` — 신규 `signature_send` 버킷(RATE_LIMITS에 추가, 기존 버킷 스타일)
3. 계약 소유·`draft` 상태 재조회 검증(FK는 RLS 우회하므로 필수)
4. `generateSigningToken()` → `hashSigningToken`
5. owner PNG를 기존 경로 `${user.id}/${contractId}/signature.png`에 업로드(기존 Storage 정책·업로드 방식 그대로)
6. `computeDocHash(clauses)` (기존 signature provider)
7. RPC `send_signature_request_with_event` 호출(토큰 해시·frozen_doc_hash·수신자·만료 14일·consent — 원자적 커밋)
8. **커밋 후 best-effort** (실패해도 액션은 성공 반환, 로깅만):
   - TSA `stamp(frozen_doc_hash)` → 성공 시 `signature_requests.sent_tsa_token` UPDATE
   - 이메일: `renderSignatureRequestEmail` + `getEmailProvider().send` — 서명 URL은 `${NEXT_PUBLIC_SITE_URL}/sign/${rawToken}` (**원문 토큰은 이 URL에만 존재, 로그·DB·반환값에 남기지 마라**)
9. `revalidatePath` + posthog `signature_request_sent`

### 2) `resendSignatureRequestEmail`

requireUser → zod(contractId) → 소유·pending 요청 존재 검증 → **신규 토큰 재발급**(기존 토큰 해시 UPDATE — 원문은 재생성해야만 URL을 만들 수 있다) → 만료 연장(14일) → 이메일 재발송. 레이트리밋 동일 버킷.

### 3) `revokeSignatureRequest`

requireUser → zod(contractId) → RPC `revoke_signature_request_with_event` → revalidatePath. Storage의 owner 서명 파일 삭제는 기존 signed→draft 리셋 경로와 동일하게 처리(기존 transition 액션 구현을 읽고 일치시켜라).

## TDD (테스트 먼저 작성)

기존 sign route 테스트의 mock 패턴(supabase mock·requireUser mock) 재사용:

1. draft 아닌 계약 → 거부
2. 비소유 계약 → 거부
3. consent 하나라도 false/누락 → zod 거부
4. 비PNG signatureDataUrl → 거부
5. 정상 경로: RPC가 올바른 인자(토큰 **해시**, 원문 아님)로 호출됨, 이메일 send가 raw 토큰 URL로 호출됨
6. 이메일 send 실패(`ok:false`)여도 액션은 성공 반환
7. TSA null이어도 액션은 성공 반환

## Acceptance Criteria

```bash
npm run lint
npm test
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - zod allowlist에 도메인 필드만 있고 user_id·status·doc_hash 등 서버 소유 필드가 없는가?
   - 원문 토큰이 반환값·로그·DB에 남지 않는가?
   - TSA·이메일 실패가 액션 실패로 전파되지 않는가?
   - 읽기를 내부 /api fetch로 우회하지 않았는가?
3. 결과에 따라 `phases/10-signature-v2/index.json`의 step 5를 업데이트한다 (성공: completed+summary / 3회 실패: error+error_message / 개입 필요: blocked+blocked_reason 후 중단).

## 금지사항

- UI 컴포넌트·페이지를 만들지 마라. 이유: step 6 소관.
- 상대방 서명 처리(anon)를 만들지 마라. 이유: step 8 소관.
- TSA 스탬프·이메일 발송을 RPC 호출 전이나 트랜잭션 개념 안에 넣지 마라. 이유: 외부 HTTP 실패가 서명 기록을 롤백시키면 안 된다 — 커밋 후 best-effort가 확정 설계.
- owner 서명 이미지를 DB base64로 저장하지 마라. 이유: owner는 기존 Storage 경로 유지 — DB 저장 예외는 counterparty 전용.
- `service_role` 키를 사용하지 마라. 이유: CLAUDE.md CRITICAL — 요청 경로 금지.
- 기존 테스트를 깨뜨리지 마라.

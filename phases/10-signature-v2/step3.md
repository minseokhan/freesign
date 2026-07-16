# Step 3: email-provider

이메일 발송 어댑터: `services/email/` 신설. **발송을 호출하는 액션·라우트는 이 step 범위가 아니다.** 이 step은 어댑터·템플릿·env 스키마만.

## 읽어야 할 파일

- `/docs/SIGNATURE_V2_PLAN.md` — §2 이메일 행(Resend REST, SDK 없이, dev 콘솔 폴백, 실패 분리), §3 Step 3
- `/docs/ADR.md` — ADR-003 provider 어댑터 패턴
- `src/services/signature/provider.ts`, `src/services/ai/contract-draft.ts` — 기존 provider/서비스 모듈 스타일(server-only 주석, 팩토리, 주입 가능한 의존성)
- `src/lib/env.ts` — env zod 스키마 구조(optional 필드 추가 방법)
- `src/services/` 하위 기존 `__tests__` — 테스트 스타일

## 작업

### 1) 신규 `src/services/email/provider.ts` (server-only)

```ts
export interface EmailAttachment { filename: string; content: string; } // content = base64
export interface EmailMessage { to: string; subject: string; html: string; text: string; attachments?: EmailAttachment[]; }
export interface EmailSendResult { ok: boolean; error?: string; }
export interface EmailProvider { send(message: EmailMessage): Promise<EmailSendResult>; }

export function createResendEmailProvider(apiKey: string, from: string, fetchFn?: typeof fetch): EmailProvider;
export function createConsoleEmailProvider(): EmailProvider;
export function getEmailProvider(): EmailProvider;
```

- Resend: `fetch`로 `https://api.resend.com/emails` POST (Authorization Bearer, JSON body에 from/to/subject/html/text/attachments). **`resend` SDK를 설치하지 마라.** attachments는 Resend API 형식(`{ filename, content }`)으로 매핑.
- `send`는 **예외를 던지지 않는다** — 실패 시 `{ ok: false, error }` 반환. 이유: 이메일 실패는 서명 트랜잭션과 분리(best-effort + 재발송 버튼) 철학.
- 콘솔 provider: to/subject와 본문 내 서명 URL이 dev 콘솔에서 복사 가능하게 출력(수동 E2E에서 링크 확보용). 항상 `{ ok: true }`.
- `getEmailProvider()`: `RESEND_API_KEY` 있으면 Resend, 없으면 콘솔. `fetchFn` 주입은 테스트용.

### 2) 신규 `src/services/email/templates.ts` (순수 함수)

```ts
export function renderSignatureRequestEmail(input: {
  recipientName: string | null; senderName: string; contractTitle: string;
  signUrl: string; expiresAt: string; // ISO
}): { subject: string; html: string; text: string };

export function renderCompletionEmail(input: {
  contractTitle: string; docHash: string; // 전문
  downloadUrl: string | null; // 첨부 실패 시 폴백 링크
  hasAttachments: boolean;
}): { subject: string; html: string; text: string };
```

- **HTML 이스케이프 필수** — 사용자 입력(수신자명·계약 제목 등)이 html에 들어가므로 이스케이프 헬퍼를 만들어 모든 삽입값에 적용하라. 이유: 이메일 HTML 인젝션 방지.
- 완료 알림 본문에 doc_hash **전문**을 노출(축약 금지). 이유: 상대방 메일함이 영구 증거 사본이 되는 설계.
- 한국어 문구. 서명 요청 메일엔 만료일 표기.

### 3) 수정 `src/lib/env.ts`

- `RESEND_API_KEY`·`EMAIL_FROM` optional 스키마 추가(기존 optional 필드 스타일 준수).

## TDD (테스트 먼저 작성)

`src/services/email/__tests__/`:

1. 템플릿: 서명 URL·만료일이 html/text에 포함, `<script>` 포함 제목이 이스케이프됨, 완료 템플릿에 doc_hash 전문 포함
2. 팩토리: RESEND_API_KEY 유무에 따른 분기(env mock)
3. Resend provider: fetchFn mock으로 URL·헤더·body 형태(attachments 포함) 검증, fetch reject/비2xx 시 `{ ok: false }` (throw 아님)
4. 콘솔 provider: `{ ok: true }` 반환

## Acceptance Criteria

```bash
npm run lint
npm test
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `provider.ts`가 server-only이고 클라이언트에서 import되지 않는가?
   - `send`가 어떤 실패에서도 throw하지 않는가?
   - 템플릿 삽입값이 전부 이스케이프되는가?
3. 결과에 따라 `phases/10-signature-v2/index.json`의 step 3을 업데이트한다 (성공: completed+summary / 3회 실패: error+error_message / 개입 필요: blocked+blocked_reason 후 중단).

## 금지사항

- `resend` npm SDK를 설치하지 마라. 이유: fetch REST 직접 호출이 확정 결정(의존성 최소화).
- 실제 이메일 발송을 테스트하지 마라(실 API 호출 금지). 이유: 유닛 테스트는 mock fetch로 충분, API 키는 CI에 없음.
- 발송을 호출하는 Server Action·라우트를 만들지 마라. 이유: step 5·8 소관.
- 이메일 큐·재시도 스케줄러 같은 인프라를 만들지 마라. 이유: 실패 복구는 수동 재발송 버튼(step 6)으로 충분 — 요청받지 않은 유연성 금지.
- 기존 테스트를 깨뜨리지 마라.

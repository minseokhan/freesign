# 인보이스 전달 경로 구현 계획 (청구 → 클라이언트)

작성일: 2026-08-03 · 상태: **구현 완료 (미커밋)** — 결정은 D1-A·D2-A·D3 무료·D4-A로 확정. 정본은 `ADR-013`.

> 실행 중 계획과 달라진 점 2가지:
> 1. `get_invoice_view`는 `invoice_id`를 **반환한다**(계획에선 반환 금지). PDF 문서번호가 인보이스 id라
>    클라이언트 사본과 소유자 사본의 번호가 같아야 대조가 되고, 소유자 라우트는 세션+RLS로 막혀 있어
>    id를 알아도 열람 권한이 생기지 않는다.
> 2. 독촉 메일은 "활성 토큰 조회 후 링크 주입"이 **불가능**하다 — 원문 토큰을 저장하지 않으므로 기존 링크를
>    되살릴 수 없다. 서명 요청 재발송과 같이 발송 시점에 새 토큰을 발급한다(이전 링크는 회수됨).

---

## 1. 배경 — 왜 필요한가

PRD의 방어 코어는 **"계약 → 지급기한 → 입금/미수 증빙"의 기록 체인**이다. 현재 이 체인의
중간 한 마디가 앱 밖에 있다.

| 단계              | 앱의 동작              | 클라이언트에게 나가는 것         |
| ----------------- | ---------------------- | -------------------------------- |
| 서명 요청         | 토큰 발급 + 메일       | ✅ `/sign/[token]`               |
| 서명 완결         | 해시·TSA 기록 + 메일   | ✅ 완결 메일 + PDF 첨부          |
| **인보이스 발행** | **상태 플래그만 전이** | **❌ 없음**                      |
| 미수 독촉         | 초안 승인 후 메일      | ⚠️ 텍스트만 (링크·계좌·PDF 없음) |

### 코드 근거 (2026-08-03 확인)

- `publishDraftInvoice()` — `src/app/(dashboard)/invoices/actions.ts:214`
  `set_invoice_payment_with_event`로 `draft→unpaid` 전이 + `invoice.issued` 이벤트만 남긴다.
  `getEmailProvider()` 호출이 없다. **발행 = 내 DB 안의 플래그 변경**일 뿐이다.
- `src/app/api/invoices/[id]/pdf/route.ts:52` — `requireUser()`로 시작한다. 소유자 전용이라
  이 URL을 클라이언트에게 보내면 로그인 화면이 뜬다. 사용자는 PDF를 내려받아 자기 메일로
  직접 보내야 하고, 그 순간 "언제 청구했는지"가 앱 기록에서 빠진다.
- `buildDunningFallback()` — `src/services/ai/dunning-draft.ts:62`
  본문에 **금액·지급기한은 텍스트로 들어간다**. 없는 것은 **입금 계좌·인보이스 원본·PDF·링크**다.
  `approveAndSendDunning()`(`dunning-actions.ts:99`)은 `to/subject/html/text`만 넘기고
  `attachments`를 쓰지 않는다. 받는 쪽은 "어디로 보내죠?"라고 회신해야 한다.

### 증거 관점의 문제

미수금 분쟁에서 필요한 문장은 "2026-07-01에 **청구서를 보냈고**, 기한은 07-15였다"이다.
지금 앱이 증명하는 것은 `invoice.issued` — **"내가 내 앱에서 발행 버튼을 눌렀다"** 뿐이다.
상대에게 도달했다는 사실이 없어, 혼자 쓴 메모와 증거 가치가 같다.

---

## 2. 목표 / 비목표

### 목표

1. 클라이언트가 로그인 없이 인보이스를 열람·PDF 다운로드할 수 있는 **공개 뷰**.
2. 발행 시 **실제 발송** + 발송 성공 시에만 남는 `invoice.sent` 이벤트 → 체인에 "청구한 날"이 기록됨.
3. 독촉 메일에 그 링크 삽입 → 받는 쪽이 링크 한 번으로 금액·계좌 확인 후 송금.

### 비목표 (이번 범위 아님)

- 온라인 결제 연동(카드·PG). 계좌 안내까지만.
- 클라이언트의 "입금했음" 셀프 신고 기능.
- 인보이스 열람에 대한 TSA 타임스탬프(서명과 달리 법적 요구가 약함).
- 크론에서의 자동 발송 — **금지**(CLAUDE.md CRITICAL: 크론은 발송하지 않는다).

---

## 3. 결정 필요 사항 (실행 전 확정)

조용히 하나를 고르지 않고 명시한다. **권장안**을 표시했다.

### D1. 토큰 수명

서명 토큰은 14일 만료(`SIGNING_REQUEST_TTL_MS`). 인보이스는 성격이 다르다 — 안 낸 사람이
계속 봐야 하므로 오래 살아야 하지만, 오래 사는 토큰은 유출 위험이 크다.

| 안           | 내용                              | 트레이드오프                                          |
| ------------ | --------------------------------- | ----------------------------------------------------- |
| **A (권장)** | `due_date + 90일`, 최소 30일 보장 | 연체 독촉 기간을 덮으면서 무한정은 아님               |
| B            | 무만료 + 소유자 수동 revoke       | 단순하지만 유출 시 영구 노출                          |
| C            | 서명과 동일하게 14일              | 연체 독촉 시 이미 만료되어 링크가 죽는다 → **부적합** |

만료 후 접근 시: "만료된 링크입니다. 발신자에게 재발송을 요청하세요" 화면 + 소유자에게 재발송 버튼.

### D2. 계좌번호 노출 범위

공개 페이지에 계좌를 띄우면 **토큰 소지자 누구나** 본다(서명 페이지보다 민감도 높음).

| 안           | 내용                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A (권장)** | 공개 페이지·PDF 모두 표시. 어차피 계좌는 청구 목적상 상대에게 알려야 하는 정보이고, 링크 없이 메일 본문에 적어 보내는 현재보다 노출이 늘지 않는다 |
| B            | 페이지에는 은행·예금주만, 계좌번호는 PDF 안에만                                                                                                   |

### D3. 무료 / Pro 게이팅

독촉·반복 인보이스는 Pro(`assertProFeature`), 서명 발송은 무료 상한(`canSendSignature`).

- **권장: 무료 제공.** 청구 전달은 제품의 코어 흐름이지 부가 기능이 아니다. 이걸 막으면
  무료 사용자는 다시 카톡으로 나가고, 제품 스토리가 다시 절반이 된다.
- 남용 방어는 게이팅이 아니라 레이트리밋으로: `RATE_LIMITS.invoiceSend = { bucket: "invoice_send", max: 5, windowSeconds: 60 }`
  (`signatureSend`·`dunningSend`와 동일 형태 — 제3자 메일함으로 나가는 경로).

### D4. 발행과 발송의 결합

클라이언트 `contact_email`은 nullable이다(`0001_schema.sql:24`).

- **권장: 한 액션에 묶되, 이메일이 없으면 발행만 하고 링크를 노출**한다.
  `sendInvoice()`가 토큰 발급 + 발행을 항상 수행하고, 이메일이 있을 때만 메일을 보낸다.
  이메일이 없으면 UI에 "링크 복사" 버튼을 띄워 소유자가 카톡 등으로 직접 전달할 수 있게 한다
  (이 경우에도 공개 뷰·PDF는 동작하므로 체인의 절반은 남는다).
- 대안: 발행/발송 버튼 분리 — UI가 복잡해지고 "발행했는데 안 보냄" 상태를 사용자가 방치하기 쉽다.

---

## 4. 설계

### 4.1 데이터 (마이그레이션 `0046_invoice_share_tokens.sql`)

`signature_requests`(0018)를 그대로 본뜬다.

```sql
create type invoice_share_status as enum ('active', 'revoked');

create table invoice_share_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  invoice_id uuid not null references invoices(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) between 32 and 128),
  recipient_email text check (recipient_email is null or char_length(recipient_email) between 3 and 320),
  status invoice_share_status not null default 'active',
  expires_at timestamptz not null,
  first_viewed_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- 인보이스당 활성 토큰 1개 (signature_requests_one_pending_per_contract와 동형)
create unique index invoice_share_tokens_one_active_per_invoice
  on invoice_share_tokens (invoice_id) where status = 'active';

create index invoice_share_tokens_owner_invoice on invoice_share_tokens (user_id, invoice_id);
```

RLS·권한:

- SELECT는 소유자 스코프 정책(`USING (user_id = (select auth.uid()))`) — 소유자 UI에서 발송 이력 표시용.
- **INSERT/UPDATE/DELETE는 클라이언트에 열지 않는다.** 0036 락다운 방침대로 쓰기는 DEFINER RPC만.
- `anon`에는 테이블 권한 없음 — 공개 열람은 anon-grant DEFINER RPC로만.

원문 토큰은 저장하지 않는다(`hashSigningToken` 재사용). 따라서 **재발송은 반드시 토큰 재발급**이다
(`resendSignatureRequestEmail`과 동일 제약).

### 4.2 RPC (같은 마이그레이션)

**1) `send_invoice_with_event`** — `SECURITY DEFINER`, `authenticated` 전용, 소유자 스코프.

```
인자: p_invoice_id, p_token_hash, p_recipient_email, p_expires_at, p_actor, p_meta
```

- `invoices`에서 `id = p_invoice_id and user_id = (select auth.uid()) and deleted_at is null` FOR UPDATE.
- 기존 활성 토큰이 있으면 `status='revoked'`로 내리고 새 토큰 INSERT (재발송 = 재발급).
- **쓰기 순서: 토큰 INSERT → `payment_status` 전이 → `invoice_events` INSERT.**
  (CLAUDE.md: status 변경을 쓰기 순서 앞쪽에 두지 말 것 — 부분 실패 시 미완 방지)
- `draft`일 때만 `unpaid`로 전이하고 `invoice.issued` 이벤트. 이미 `unpaid`면 전이 없이 토큰만 교체(재발송).
- `paid`/`overdue` 등 정산된 인보이스는 예외 발생.

**2) `get_invoice_view(p_token_hash)`** — `SECURITY DEFINER`, `anon` 전용.
`get_signing_session`(0019)·`get_signed_contract_data`(0020)와 동일 규칙:
`search_path` 고정, `revoke ... from public`, 입력 길이 상한(32~128), **최소 필드만 반환**.

- 반환: `state`(`active`|`expired`|`revoked`|`not_found`), 그리고 active일 때만
  금액·원천징수·실수령·발행일·지급기한·계약 제목(또는 `contract_snapshot`)·클라이언트명·
  발신자 표시명·계좌(D2 결정에 따름).
- **반환 금지**: `user_id`, 인보이스 id(UUID), 다른 인보이스 정보, 내부 상태값.
- 첫 열람 시 `first_viewed_at`을 기록한다(→ 페이지는 `force-dynamic`).

**3) `invoice.sent` 이벤트는 기존 `append_invoice_event`(0036) 재사용** — 신규 RPC 불필요.
이미 `authenticated` grant + 소유자 스코프 검증이 들어 있다.

### 4.3 발송 흐름 — 이벤트를 둘로 나누는 이유

토큰이 DB에 있어야 링크가 유효하므로 "메일 먼저"는 불가능하다(서명 요청과 같은 제약).
그래서 서명 패턴대로 **커밋 후 best-effort 메일**을 쓰되, 그러면 "보냈다고 기록됐는데 안 간"
경우가 생긴다. 해결:

```
[트랜잭션]  send_invoice_with_event
              → 토큰 INSERT → draft→unpaid → invoice.issued 이벤트
[커밋 후]   이메일 발송
              성공 시에만 → append_invoice_event(invoice.sent, to_status='unpaid')
              실패 시     → 이벤트 없음. UI에 "발송 실패 · 재발송" 표시
```

`invoice_events`는 append-only이고 `to_status`가 not null이므로, 상태 전이 없는 `invoice.sent`는
`from_status = to_status = 'unpaid'`로 남긴다.

**결과: "청구한 날"의 증거가 실제 발송 성공에만 붙는다.** 이것이 이 계획의 핵심 산출물이다.

### 4.4 라우트

| 신규 파일                                   | 역할                                                                        | 본뜬 파일                        |
| ------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| `src/app/(public)/invoice/layout.tsx`       | `robots: { index: false, follow: false }`                                   | `(public)/sign/layout.tsx:11`    |
| `src/app/(public)/invoice/[token]/page.tsx` | 공개 뷰 RSC, `force-dynamic`, `createAnonClient()` + `get_invoice_view`     | `(public)/sign/[token]/page.tsx` |
| `src/app/api/invoice/[token]/pdf/route.ts`  | 토큰 인가 PDF. `consume_anon_rate_limit`(bucket `invoice_pdf`, 10/60s) 선행 | `api/sign/[token]/pdf/route.ts`  |

경로 주의: 소유자용은 복수형 `/api/invoices/[id]/pdf`, 공개용은 단수형 `/api/invoice/[token]/pdf` — 충돌 없음.

PDF 렌더는 현재 라우트 안에 인라인(`renderToBuffer` 직접 호출)이라 두 곳에서 중복된다.
`renderContractPdf`와 대칭으로 `src/lib/invoices/render-pdf.ts`에 `renderInvoicePdf()`를 추출하고
양쪽이 호출한다. `mapInvoicePdfProps`는 그대로 재사용.

`robots.ts`의 `disallow`에는 이미 `/invoices`(복수)가 있다. 공개 경로 `/invoice/`(단수)는
포함되지 않으므로 `disallow`에 `/invoice/`를 추가한다 — 레이아웃 noindex와 이중 방어.

### 4.5 이메일

`src/services/email/templates.ts`에 추가:

```ts
export interface InvoiceIssuedEmailInput {
  clientName: string | null;
  senderName: string;
  contractTitle: string; // 또는 contract_snapshot.title
  amountNet: number;
  dueDate: string; // ISO
  invoiceUrl: string;
  expiresAt: string; // ISO
}
export function renderInvoiceIssuedEmail(input): RenderedEmail;
```

기존 템플릿 규칙 준수: 모든 삽입값 `escapeHtml`, 날짜는 `formatKstDate`, html/text 양쪽 제공.

**독촉 메일 링크 삽입** — `DunningEmailInput`에 `invoiceUrl?: string`을 추가한다.
초안 본문은 소유자가 승인한 확정 텍스트이므로 **본문을 조작하지 않고**, 렌더 시 본문 뒤에
별도 문단으로 링크를 덧붙인다. 토큰이 없는 과거 인보이스는 링크를 생략한다(선택적 필드).

### 4.6 Server Action

`src/app/(dashboard)/invoices/actions.ts`:

- `publishDraftInvoice()`를 **`sendInvoice(input)`으로 대체**한다(구 함수는 제거 —
  발행만 하고 안 보내는 경로를 남겨두면 같은 구멍이 그대로 남는다).
- 순서: `requireUser()` → zod allowlist(`{ invoiceId: uuid }`만) → `checkRateLimit(RATE_LIMITS.invoiceSend)`
  → 소유권·상태 재조회 → 토큰 생성 → RPC → 커밋 후 메일 best-effort → `append_invoice_event`
  → `revalidatePath` → PostHog.
- 토큰 원문(`rawToken`)은 **반환값에 담지 않는다**. 링크 복사 UI가 필요한 D4-A 경우에만
  액션 반환값에 1회 포함하고 화면에서만 사용한다(DB·로그에 남기지 않음).
- `src/components/publish-draft-button.tsx` → `SendInvoiceButton`으로 갱신, 확인 다이얼로그에
  수신 이메일을 표시한다(오발송 방지).

---

## 5. 아키텍처 규칙 준수 체크 (CLAUDE.md CRITICAL 대조)

| 규칙                                                       | 준수 방법                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 읽기는 RSC 직접 조회, 쓰기는 Server Action                 | 공개 뷰는 RSC + anon RPC, 발송은 Server Action                                 |
| 시크릿·외부 API는 서버 전용                                | 토큰 생성·해시는 `node:crypto`, server-only 모듈                               |
| RLS `USING` + `WITH CHECK` 양쪽                            | 신규 테이블 SELECT 정책에 둘 다. 쓰기는 아예 미개방                            |
| zod allowlist, 서버 소유 필드 client 입력 금지             | 액션 입력은 `invoiceId`뿐. `token_hash`·`expires_at`·`status`는 서버 생성      |
| FK 참조는 소유권 재조회 검증                               | RPC 내부에서 `user_id = (select auth.uid())` 확인                              |
| 세션 없는 경계 쓰기는 시크릿 게이트 DEFINER RPC            | 공개 뷰는 **읽기 + first_viewed_at 기록**뿐. 클라이언트가 상태를 바꾸지 못한다 |
| `service_role` 요청 경로 금지                              | `createAnonClient()`만 사용                                                    |
| 크론은 발송하지 않는다                                     | 크론 코드 무변경. 발송은 세션 있는 액션에서만                                  |
| 상태 전이는 이벤트 로그와 함께, status를 앞쪽에 두지 말 것 | 토큰 → status → 이벤트 순 (4.2)                                                |
| `deleted_at IS NULL`은 공용 쿼리 헬퍼에서                  | `notDeleted()` 사용, RPC 내부에도 조건 포함                                    |
| 서버 인가는 `getUser()`                                    | `requireUser()` 경유                                                           |

---

## 6. 구현 단계 (TDD — 테스트 먼저)

각 단계는 **검증 기준을 통과해야** 다음으로 넘어간다.

### 단계 1 — 마이그레이션 + RPC

1. `supabase/migrations/0046_invoice_share_tokens.sql` 작성.
2. **검증:** 로컬 `supabase db reset` 통과 → 원격은 MCP `apply_migration`으로 별도 적용
   (git 커밋만으로는 원격에 반영되지 않음).
3. **검증(권한):** SQL로 확인 —
   - `anon`이 `invoice_share_tokens`를 직접 SELECT 불가
   - `anon`이 `send_invoice_with_event` 실행 불가
   - `authenticated`가 `get_invoice_view` 실행 불가(anon 전용)
   - 타인 인보이스 id로 `send_invoice_with_event` 호출 시 예외

### 단계 2 — 이메일 템플릿 (순수 함수, 테스트 먼저)

1. `src/services/email/__tests__/templates.test.ts`에 케이스 추가:
   `renderInvoiceIssuedEmail`이 금액·기한·링크를 포함하는가 / 이름에 `<script>`가 들어가면
   escape되는가 / `renderDunningEmail`이 `invoiceUrl` 없으면 링크 문단을 넣지 않는가.
2. 구현 → **검증:** `npm run test` 그린.

### 단계 3 — PDF 렌더 추출

1. `src/lib/invoices/render-pdf.ts`로 `renderInvoicePdf()` 추출, 기존 소유자 라우트가 이를 호출.
2. **검증:** 기존 인보이스 PDF 테스트 그린 + 소유자 다운로드 수동 확인(회귀 없음).

### 단계 4 — Server Action

1. `src/app/(dashboard)/invoices/__tests__/actions.test.ts`에 케이스 먼저:
   - draft가 아닌 정산 완료 인보이스는 발송 거부
   - 타인 인보이스 발송 거부
   - 레이트리밋 초과 시 거부
   - **메일 실패 시 `invoice.sent` 이벤트가 남지 않는다** (핵심)
   - 메일 성공 시 `invoice.issued` + `invoice.sent` 둘 다 남는다
   - 재발송 시 기존 토큰이 revoked 되고 새 해시가 저장된다
   - 클라이언트 이메일이 없으면 발행은 되고 메일은 시도하지 않는다
2. 구현 → **검증:** `npm run test` 그린.

### 단계 5 — 공개 뷰 + PDF 라우트

1. 라우트 테스트 먼저: 존재하지 않는 토큰 / 만료 토큰 / revoked 토큰 → 각각 올바른 화면·상태코드.
2. 구현 → **검증:** `npm run test` + `npm run build:verify` 그린.

### 단계 6 — 독촉 메일 링크

1. `approveAndSendDunning`에서 활성 토큰 조회 → `invoiceUrl` 주입. 토큰 없으면 생략.
2. **검증:** 기존 독촉 테스트 그린 + 링크 주입 케이스 추가.

### 단계 7 — E2E + 브라우저 검증

1. Playwright: 인보이스 발행 → 공개 링크 접근 → 금액·기한 표시 → PDF 다운로드.
2. dev-browser CLI로 수동 확인(로그인 상태가 아닌 컨텍스트에서 공개 링크가 열리는지).
3. **검증:** `npx playwright test` 그린.

### 단계 8 — 문서

`docs/ARCHITECTURE.md`(데이터 흐름)·`docs/DATABASE.md`(신규 테이블)·`docs/ADR.md`에 반영.
공개 토큰 표면이 하나 늘어난 것은 ADR급 결정이므로 ADR 항목을 새로 쓴다.

---

## 7. 보안 고려

- **토큰 유출 = 금액·계좌 노출.** 서명 토큰과 동일하게 원문 미저장·해시 비교·만료·revoke를 갖춘다.
  추가로 공개 페이지·PDF 라우트 모두 `consume_anon_rate_limit`으로 열거 공격을 막는다.
- **인보이스 UUID 미노출.** 공개 뷰 반환에 인보이스 id를 넣지 않는다(소유자 라우트 추측 방지).
- **noindex 이중 방어.** 레이아웃 metadata + `robots.ts` disallow.
- **CSP.** 기존 `(public)/sign`과 같은 정책이 적용되는지 `src/lib/csp.ts` 확인 — 공개 페이지에
  새 외부 리소스를 추가하지 않으므로 변경은 없을 것으로 예상하나 빌드 후 실제 헤더로 확인한다.
- **오발송.** 발송 버튼에 수신 이메일을 표시하는 확인 단계를 둔다(취소 불가한 외부 발송이므로).

---

## 8. 잔여 위험 / 열린 질문

1. **`contract_snapshot` 인보이스.** 계약이 물리 삭제된(ADR-008) 인보이스는 `contract_id`가 NULL이고
   `contract_snapshot`에 요약만 있다. 공개 뷰·메일 모두 이 폴백 경로를 타야 한다 — 테스트 필수.
2. ~~**`invoice.sent` 도입 후 기존 지표.**~~ 확인 결과 `lib/metrics.ts`·`lib/insights.ts`는
   `invoice_events`를 참조하지 않는다(집계는 `invoices` 테이블 기준). 지표 회귀 위험 없음.
3. **과거 인보이스 마이그레이션 없음.** 이미 `unpaid`인 기존 인보이스에는 토큰이 없다.
   소유자 UI에 "링크 발송" 버튼을 노출해 사후 발송이 가능하게 한다(백필하지 않음).
4. **RESEND 키.** 프로덕션 이메일 발송 키가 아직 설정되지 않았다면 이 기능은
   `createUnconfiguredEmailProvider()`로 떨어져 항상 발송 실패가 된다. 배포 전 확인.

---

## 9. 예상 변경 규모

| 종류   | 파일                                                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 신규   | 마이그레이션 1, 공개 페이지 1, 공개 레이아웃 1, PDF 라우트 1, `lib/invoices/render-pdf.ts` 1                                             |
| 수정   | `invoices/actions.ts`, `dunning-actions.ts`, `templates.ts`, `rate-limit.ts`, `robots.ts`, `publish-draft-button.tsx`, 소유자 PDF 라우트 |
| 테스트 | 템플릿·액션·라우트 단위 + E2E 1                                                                                                          |

새로 설계할 것은 사실상 **토큰 수명 정책(D1)** 하나뿐이고, 나머지는 서명 파이프라인에서
검증된 패턴의 재사용이다.

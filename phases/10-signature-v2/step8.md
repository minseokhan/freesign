# Step 8: public-sign

상대방(counterparty)의 비로그인 서명: 공개 페이지 `/sign/[token]`, anon 서명 API, 완료 이메일(PDF 첨부), 상대방용 다운로드 라우트. v2의 핵심 신규 표면이다.

## 읽어야 할 파일

- `/docs/SIGNATURE_V2_PLAN.md` — §2(anon 접근·상대 서명 이미지·증거 당사자 배포·토큰 행), §3 Step 6, §4 리스크 1·5
- `/CLAUDE.md` — service_role 요청 경로 금지, 시크릿·외부 API는 라우트 핸들러/서버 전용 모듈에서만
- `src/app/api/contracts/[id]/sign/route.ts` — 기존 라우트의 zod·에러 응답·IP/UA 추출 방식(추출 대상)
- `supabase/migrations/0019_signature_rpcs.sql` — `get_signing_session`·`complete_counterparty_signature_with_event`·`get_certificate_data`·`consume_anon_rate_limit` 시그니처와 에러코드
- `src/lib/supabase/` — 서버 클라이언트 생성 방식(anon 키 클라이언트로 RPC 호출)
- 이전 step 산출물: `src/components/signature-canvas.tsx`(step 6), `src/services/email/`(step 3), `src/services/timestamp/provider.ts`(step 4), `src/lib/contracts/render-pdf.ts`·`certificate.ts`(step 7), `src/lib/signing-token.ts`(step 0)
- `src/app/(dashboard)/layout.tsx` 등 기존 레이아웃 — 공개 레이아웃이 배제해야 할 대시보드 셸 파악

## 작업

### 1) 신규 `src/app/(public)/sign/[token]/page.tsx` (RSC) + `src/app/(public)/sign/layout.tsx`

- 전용 layout: 대시보드 셸(사이드바·인증 가드) 없음, 최소한의 브랜드 헤더.
- page: `hashSigningToken(params.token)` → anon supabase 클라이언트로 `get_signing_session` RPC → 분기 렌더:
  - null(무효 토큰) / expired / revoked → 각각 안내 화면(재요청 안내 문구)
  - pending → 계약 조항 **read-only** 표시 + doc_hash 축약 표기 + 서명 폼(아래 2)
  - completed → 완료 안내 + 계약서 PDF·완결증명서 다운로드 링크(아래 4의 라우트)
- 메타: `robots: { index: false }`, 응답 헤더 `Referrer-Policy: no-referrer` (토큰 URL 유출 방지 — layout 또는 route segment config에서).

### 2) 신규 `src/components/counterparty-sign-form.tsx` (client)

- SignatureCanvas 재사용 + 서명자 이름 입력 + 동의 체크 2종(전자서명 약정·개인정보, 기본 해제) + 제출.
- 제출 → `POST /api/sign/[token]` fetch → 성공 시 완료 상태로 전환(router.refresh 또는 상태 전환), 에러코드별 한국어 안내(만료·이미 완료·계약 변경됨).

### 3) 신규 `src/app/api/sign/[token]/route.ts` — POST (anon 서명 처리)

순서:
1. IP 추출 → `src/lib/request-meta.ts`로 추출·공유: 기존 sign route의 `getRequestIp`·UA 추출을 이 모듈로 옮기고 기존 route도 이를 쓰도록 수정 (`export function getRequestIp(request: Request): string`, `getRequestUserAgent`)
2. `consume_anon_rate_limit(sha256(ip), 'counterparty_sign', 5, 60)` → false면 429
3. zod: `{ signerName(길이 상한), signatureDataUrl(PNG data URL, ≤200KB), consentElectronicSignature: literal(true), consentPrivacy: literal(true) }`
4. RPC `complete_counterparty_signature_with_event` **단일 호출** — Node에서 사전 SELECT 검증하지 마라(TOCTOU 제거가 확정 설계). RPC 에러코드 → HTTP 매핑: 만료/철회 → 410, 이미 완료/해시 불일치 → 409, 무효 토큰 → 404
5. **커밋 후 best-effort** (모두 실패해도 200 — 서명은 이미 커밋됨, 로깅만):
   - TSA: `stamp(sha256(doc_hash ∥ sha256(서명 이미지 base64 디코드 바이트)))` → `completion_tsa_token` UPDATE (결합 다이제스트 구성은 순수 함수로 분리해 테스트)
   - 완료 이메일 **2통(owner + counterparty)**: `renderCompletionEmail` — 본문에 doc_hash **전문**, 첨부로 서명 완료 계약서 PDF(`renderContractPdf` + 상대 서명 슬롯)·완결증명서 PDF(`renderCertificatePdf`). 첨부 생성·발송 실패 시 본문 다운로드 링크 폴백(hasAttachments=false로 재렌더)
   - posthog `contract_counterparty_signed` (distinctId=owner user_id — anon 방문자 id를 만들지 마라)

### 4) 상대방 교부용 다운로드 라우트 (anon)

- 신규 `src/app/api/sign/[token]/certificate/route.ts` GET: anon 레이트리밋(`certificate_download` 버킷) → `get_certificate_data(p_token_hash)` → null이면 404 → `buildCertificateProps` → `renderCertificatePdf`
- 신규 `src/app/api/sign/[token]/pdf/route.ts` GET: 동일 패턴으로 서명 완료 계약서 PDF(상대 서명 슬롯 포함)
- 둘 다 Node 런타임, completed 요청만 응답.

## TDD (테스트 먼저 작성)

기존 sign route 테스트 mock 패턴 재사용:

1. POST: 동의 미체크 → 400, 비PNG/200KB 초과 → 400
2. POST: RPC 에러코드 매핑 — 만료 410, 이중 완료 409, 해시 불일치 409, 무효 404
3. POST: 레이트리밋 false → 429
4. POST: TSA·이메일 실패에도 200 반환
5. 결합 다이제스트 순수 함수: 고정 입력 → 결정적 출력
6. certificate/pdf GET: 미완료 토큰 404

## Acceptance Criteria

```bash
npm run lint
npm test
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - anon 경로 어디에도 `service_role`이 없는가?
   - RPC 단일 호출 전에 Node 사전 검증 SELECT가 없는가?
   - 공개 페이지에 noindex·no-referrer가 걸려 있는가?
   - 완료 응답이 TSA·이메일 실패와 무관하게 서명 커밋 결과를 반영하는가?
3. 결과에 따라 `phases/10-signature-v2/index.json`의 step 8을 업데이트한다 (성공: completed+summary / 3회 실패: error+error_message / 개입 필요: blocked+blocked_reason 후 중단).

## 금지사항

- `service_role` 키를 사용하지 마라. 이유: CLAUDE.md CRITICAL — anon 접근은 DEFINER RPC 경유가 확정 설계.
- 상대 서명 이미지를 Storage에 올리지 마라. 이유: anon은 Storage RLS 통과 불가 — DB base64 저장이 확정 결정(ADR-009).
- 서명 완료 처리에서 RPC 앞에 검증용 SELECT를 넣지 마라. 이유: TOCTOU — 검증은 RPC 트랜잭션 내부에서만.
- 공개 페이지에서 authenticated supabase 클라이언트·getUser()를 요구하지 마라. 이유: 비로그인 서명이 핵심 요구사항.
- 완료 이메일 실패 시 5xx를 반환하지 마라. 이유: 서명은 이미 커밋 — 실패는 로깅+폴백.
- 기존 테스트를 깨뜨리지 마라.

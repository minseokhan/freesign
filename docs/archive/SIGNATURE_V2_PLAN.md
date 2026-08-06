# 쌍방 전자서명 v2 계획

> ✅ **구현 완료(phase 10, 2026-07-17)** — `phases/10-signature-v2/` step 0~9로 전체 구현. 결정 기록은 `docs/ADR.md` ADR-009.
> 작성: 2026-07-16. 실행은 별도 지시 후 진행.
> 관련 문서: `docs/LEGAL_SIGNATURE.md`(법적 검토·v2 구상 원본), `docs/ADR.md`(ADR-003 provider 어댑터), `docs/DATABASE.md`

## 1. 배경과 목표

v1 서명은 계약 소유자(프리랜서) 본인 서명만 존재하며 `legalEffect: "none"` — 상대방 동의 증거가 없어 계약 성립 증명으로는 반쪽이다. v2는 **상대방(주로 기업 담당자)이 비로그인으로 서명하는 맞서명**을 구현해 "계약 → 지급기한 → 입금/미수 증빙" 기록 체인의 시작점을 완성한다.

### 확정된 제품 결정 (2026-07-16 인터뷰)
- **자체 구현** — 외부 서명 SaaS(모두싸인 등) 미사용. 기존 `SignatureProvider` 인터페이스 확장. 건당 비용 0원.
- **시나리오** — 내가 만든 계약 → 상대방 이메일로 서명 링크 발송 → 상대방은 **비로그인 서명**. 기업 담당자가 우리 서비스에 가입/로그인할 필요 없음(모두싸인 등 업계 표준과 동일한 UX). 업로드 계약(import) 맞서명은 이번 범위 제외.
- **본인확인** — 이메일 링크 수신 = 소유 확인 수준. 추가 인증(접근 암호·휴대폰 인증)은 확장 지점만 남긴다.
- **범위** — 맞서명 + 완결증명서(감사추적 PDF) + 이메일 발송/알림 + **RFC 3161 타임스탬프(TSA)**까지 한 번에.

### 법적 근거 (리서치 완료)
- 민법 낙성·불요식 원칙: "상대방이 이 내용에 동의했다"를 증명하면 형식 불문 계약 성립.
- 전자서명법 3조 2항: 당사자 간 약정으로 선택한 전자서명은 서명 효력 → 서명 시점에 **명시적 동의 캡처** 필요.
- 증거력의 실체 = ① 이메일 소유확인 ② 발송 시점 doc_hash 동결 + 서명 시점 일치 검증 ③ 시각·IP·UA 감사추적 ④ 완결증명서.
- `docs/LEGAL_SIGNATURE.md` 기존 v2 구상(§A-3 완결증명서, §A-4 맞서명/서명 링크, §A-5 동의 캡처)과 일치.

## 2. 핵심 설계 결정

| 쟁점 | 결정 | 이유 |
|---|---|---|
| 상태 머신 | `sent` 상태 추가: draft → sent → signed | `updateContractClauses`가 draft만 허용하므로 발송 즉시 조항 편집 잠금이 공짜. 조인 없이 목록·전이 가드 처리 |
| 서명 복수화 | `contract_signatures` 별도 테이블 (party: owner/counterparty) | 증거 보존을 DB 수준에서 해결, 완결증명서 서명자 열거 균일. 기존 contracts flat 컬럼(signature_image_path 등)은 owner 호환용 유지 — 데이터 마이그레이션 불필요 |
| 서명 순서 | owner 선서명 → 발송 → 상대 서명 시 signed ("서명하고 요청 보내기" 단일 액션) | 순서 무관 설계는 RPC 분기·UI 상태 2배. 기존 단독 서명(draft→signed) 경로는 그대로 보존 |
| anon 접근 | SECURITY DEFINER RPC (`search_path = public, pg_temp` 고정, anon grant) | CLAUDE.md가 요청 경로 service_role 금지. RLS 우회 표면을 함수 몇 개로 국한 |
| 상대 서명 이미지 | DB 저장 (base64 text, ≤256KB CHECK) — Storage 아님 | anon은 Storage RLS 통과 불가(토큰 검증을 storage 정책으로 표현 불가). 캔버스 PNG ~30KB라 실용적, 서명 행과 증거 결합. "DB엔 key만" 규칙의 명시적 예외로 ADR-009 기록 |
| 증거 보존 vs 물리삭제 | counterparty 서명 존재 시 계약 삭제 차단(트리거) + '취소(무효화)'로 유도. signed→draft 리셋도 차단 | LEGAL_SIGNATURE.md:100 경고 반영("삭제 대신 무효화 이벤트"). sent(상대 서명 전)에는 철회 후 삭제 가능 |
| 이메일 | `services/email/` EmailProvider 어댑터 + Resend REST(fetch, SDK 없이) + dev 콘솔 폴백 | ADR-003 provider 패턴. 이메일 실패는 서명 트랜잭션과 분리(RPC 커밋 후 best-effort + 재발송 버튼) |
| legalEffect | `"none"` → `"record"`(단독 기록) / `"mutual"`(맞서명) | LEGAL_SIGNATURE.md:41 — "효력 없음"은 부정확, 입증력 단계 표현으로 전환 |
| 토큰 | crypto.randomBytes(32) base64url. DB엔 SHA-256 해시만. 만료 14일. 계약당 pending 1건(partial unique) | 원문 토큰은 발송 순간에만 존재, DB 유출돼도 서명 불가 |
| TSA 부재 | `services/timestamp/` **TimestampProvider 어댑터** + 무료 공용 RFC 3161(기본 freeTSA.org, `TSA_URL` env로 교체 가능) | "운영자가 해시를 나중에 조작하지 않았다"를 제3자 서명 토큰(TST)으로 증명. RFC 3161 표준이라 국내 공인 TSA(한국정보인증 등)로 **엔드포인트 교체만으로 승급**. 스탬프 실패는 서명 플로우 비차단(best-effort — AI 폴백과 동일 철학) |
| 증거 당사자 배포 | 완료 알림 이메일에 doc_hash **전문** + **서명 완료 계약서 PDF·완결증명서 PDF 첨부**를 양측에 발송 | 상대방이 영구 사본을 메일함에 보유 → 운영자 단독 조작이 구조적으로 불가("자기 증거" 문제의 최강 해소책). 토큰 만료와 무관한 교부. 모두싸인 등 업계 표준. 첨부 실패 시 본문 링크 폴백 |

## 3. 구현 단계 (TDD: 각 단계 테스트 먼저)

### Step 1 — 순수 함수·타입
- 신규 `src/lib/signing-token.ts`: `generateSigningToken()`, `hashSigningToken()` (server-only)
- 수정 `src/lib/contract-status.ts`: `sent` 추가. draft→[signed,sent,canceled], sent→[signed,draft,canceled]. `getContractStatusTransition(from, to, ctx?: {hasCounterpartySignature})` — 상대 서명 존재 시 to==="draft" 차단. sent/signed 진입은 일반 전이 입력에서 거부(전용 절차에서만)
- 수정 `src/services/signature/provider.ts`: `legalEffect: "record" | "mutual"` — 기존 `"none"` 참조처(sign route 응답·이벤트 meta·UI 문구) 일괄 갱신
- **테스트 먼저**: 전이 매트릭스(sent 허용/차단), hasCounterpartySignature=true 시 signed→draft 차단, sent→draft 리셋 플래그, 토큰 길이·base64url·해시 결정성

### Step 2 — 마이그레이션 (스키마·RLS·RPC)
- 신규 `supabase/migrations/0017_contract_status_sent.sql`: `alter type contract_status add value if not exists 'sent' after 'draft';` **단독 파일** — 테스트 하네스가 마이그레이션을 파일별 개별 쿼리로 적용하므로(`src/test/pg.ts:118`) 커밋 분리 문제 없음
- 신규 `supabase/migrations/0018_mutual_signature.sql`:
  - `signature_requests`: user_id, contract_id(CASCADE — 미서명 요청은 계약과 함께 소멸), token_hash unique, recipient_email/name, status enum(pending/completed/revoked), **frozen_doc_hash**, expires_at, first_viewed_at, completed_at, **sent_tsa_token text / completion_tsa_token text**(RFC 3161 TST base64, 서버 소유, 커밋 후 best-effort UPDATE). `(contract_id) where status='pending'` partial unique
  - `contract_signatures`: user_id(계약 소유자 스코프), contract_id(CASCADE), request_id, party enum(owner/counterparty), signer_email/name, `signature_image_path`(owner: Storage key) XOR `signature_image_data`(counterparty: base64, ≤256KB) CHECK, doc_hash, consent jsonb, meta jsonb. **update/delete 정책 없음 = 불변 증거**
  - RLS: 둘 다 owner-only(`to authenticated`, USING+WITH CHECK 둘 다). anon 정책 없음 — anon은 DEFINER RPC 경유만
  - 트리거: counterparty 서명 존재 계약 BEFORE DELETE 차단
  - anon 레이트리밋: `anon_rate_limit_events` + `consume_anon_rate_limit()` DEFINER (기존 rate_limit_events는 user_id NOT NULL이라 별도)
  - RPC (0012 `*_with_event` 패턴, search_path 고정, revoke from public):
    1. `send_signature_request_with_event(...)` INVOKER, grant authenticated — draft→sent + contracts에 owner 서명 기록 + contract_signatures(owner) INSERT + signature_requests INSERT + 이벤트 `signature_request.sent`, 원자적
    2. `get_signing_session(p_token_hash)` DEFINER, grant anon — 상태별 최소 필드 jsonb(무효→null, 만료→state만, pending→계약 열람 필드, completed→다운로드 필드). pending 유효 시 first_viewed_at **null일 때만 1회** 기록 + `signature_request.viewed` 이벤트
    3. `complete_counterparty_signature_with_event(...)` DEFINER, grant anon — FOR UPDATE 잠금 → pending·미만료·contract=sent·**doc_hash==frozen_doc_hash** 검증 → contract_signatures(counterparty) INSERT + request completed + sent→signed + 이벤트 `contract.counterparty_signed`(actor `counterparty:<email>`, meta에 ip/ua/consent), 단일 트랜잭션. 1회성은 status 검증으로 보장. 반환: 완료 알림용 이메일들
    4. `revoke_signature_request_with_event(...)` INVOKER — pending 철회 + sent→draft + 서명 아티팩트 리셋 + 이벤트
    5. 기존 `transition_contract_status_with_event` 수정: to=draft & counterparty 서명 존재 시 raise (DB 이중 가드)
- `src/types/database.ts` 재생성 (`supabase gen types`). **원격 반영은 MCP apply_migration 수동 필요**
- **테스트 먼저** (embedded-postgres, `src/test/__tests__/schema.test.ts` 패턴): anon 직접 SELECT 불가, get_signing_session 유효/만료/철회/오토큰 4분기, complete 정상→signed+이벤트, **이중 완료 실패**, **frozen_doc_hash 불일치 실패**, 삭제 트리거 차단, signed→draft raise, pending 중복 실패, 레이트리밋 윈도우

### Step 3 — 이메일 어댑터
- 신규 `src/services/email/provider.ts`: `EmailProvider { send({to, subject, html, text, attachments?: {filename, content(base64)}[]}) }`, `createResendEmailProvider(apiKey, from)` (fetch로 api.resend.com/emails POST, attachments 지원), `createConsoleEmailProvider()` (dev 폴백), `getEmailProvider()` 팩토리(RESEND_API_KEY 없으면 콘솔)
- 신규 `src/services/email/templates.ts`: 순수 함수 2종 — 서명 요청(수신자명·발신자명·계약 제목·서명 URL·만료일), 완료 알림(계약 제목·doc_hash 전문·첨부 안내). HTML 이스케이프 필수
- 수정 `src/lib/env.ts`: `RESEND_API_KEY`/`EMAIL_FROM` optional 스키마
- **테스트 먼저**: 템플릿(링크·만료일 포함, 이스케이프), 팩토리 폴백 분기, Resend fetch mock 요청 형태

### Step 4 — 타임스탬프 어댑터 (RFC 3161)
- 신규 `src/services/timestamp/provider.ts` (server-only):
  - `TimestampProvider { stamp(sha256Hex: string): Promise<{ token: string; tsaUrl: string; stampedAt: string } | null> }`
  - `createRfc3161TimestampProvider(url)`: TimeStampReq DER **수동 조립**(SHA-256용 고정 프리픽스 + 해시 32바이트 + nonce, 외부 ASN.1 라이브러리 의존 없이) → `POST` `Content-Type: application/timestamp-query` → TimeStampResp에서 status(granted) 최소 확인 후 **응답 토큰 원문을 base64로 그대로 저장**(파싱 최소화). 검증 절차는 `openssl ts -verify` 커맨드로 문서화
  - `createNoopTimestampProvider()`: env 미설정·dev 폴백 (null 반환)
  - `getTimestampProvider()` 팩토리 — `TSA_URL` env optional(기본 freeTSA.org), `src/lib/env.ts`에 추가
- 스탬프 시점 2곳 (둘 다 **RPC 커밋 후 best-effort** — 실패해도 서명 플로우 비차단, 로깅만):
  1. **발송 시**: frozen_doc_hash 스탬프 → `signature_requests.sent_tsa_token` ("발송 시점에 이 내용이 존재했다")
  2. **완결 시**: `sha256(doc_hash ∥ 상대 서명 이미지 sha256)` 결합 다이제스트 스탬프 → `completion_tsa_token` ("이 시점에 상대 서명까지 존재했다")
- 토큰 없을 때 완결증명서에는 "타임스탬프 미확보" 명시 (과대표시 금지)
- **테스트 먼저**: TimeStampReq DER golden bytes(해시 삽입 위치·프리픽스), granted status 확인 분기, noop 폴백, fetch 실패 시 null 반환(비차단)

### Step 5 — 발송 플로우 (owner)
- 서버 액션 `sendSignatureRequest` / `resendSignatureRequestEmail` / `revokeSignatureRequest` (`src/app/(dashboard)/contracts/actions.ts` 또는 인접 파일)
- zod allowlist: `{ recipientEmail, recipientName, signatureDataUrl(기존 PNG regex), consentElectronicSignature: literal(true), consentPrivacy: literal(true) }`
- 흐름: requireUser → zod → 레이트리밋(`signature_send` 버킷, 기존 checkRateLimit 재사용) → 소유·draft 확인 → 토큰 생성 → owner PNG를 기존 경로 `${user.id}/${id}/signature.png` 업로드(기존 Storage 정책 그대로) → `computeDocHash(clauses)` → RPC → **커밋 후** TSA 스탬프(sent_tsa_token, best-effort) + 이메일 발송(`${NEXT_PUBLIC_SITE_URL}/sign/${rawToken}`) → revalidatePath + posthog `signature_request_sent`
- UI: `signature-pad.tsx`의 캔버스를 `src/components/signature-canvas.tsx`로 추출(공개 페이지와 공유), 신규 `signature-request-form.tsx`(수신자 입력 + 캔버스 + 동의 체크 2종 + "서명하고 요청 보내기"), 계약 상세 draft에 탭(단독 서명 | 상대방 서명 요청), sent 카드(수신자·만료·열람시각·재발송·철회)
- **테스트 먼저**: draft 아님 거부, 동의 미체크 zod 거부, 비소유 거부 (기존 sign route mock 패턴 재사용)

### Step 6 — 공개 서명 페이지 + anon API
- 신규 `src/app/(public)/sign/[token]/page.tsx` (RSC) + 전용 layout(대시보드 셸 없음): 토큰 해시 → anon supabase로 `get_signing_session` → 무효/만료/철회 안내 | pending(조항 read-only + doc_hash 축약 + 서명 폼) | completed(완료 + 다운로드). `robots: noindex`, `Referrer-Policy: no-referrer`(토큰 URL 유출 방지)
- 신규 `src/components/counterparty-sign-form.tsx`: SignatureCanvas 재사용 + 이름 + 동의 체크 2종 + 제출
- 신규 `src/app/api/sign/[token]/route.ts` POST: `consume_anon_rate_limit(ip_hash, 'counterparty_sign', 5, 60)` 실패 시 429 → zod(PNG ≤200KB, consent literal(true)) → RPC **단일 호출**(Node 사전 검증 없음 — TOCTOU 제거) → 커밋 후 TSA 완결 스탬프(completion_tsa_token, best-effort) + **완료 이메일 2통(양측): 본문에 doc_hash 전문 + 서명 완료 계약서 PDF·완결증명서 PDF 첨부**(Step 7의 render-pdf·certificate 재사용, 첨부 생성·발송 실패 시 본문 다운로드 링크 폴백 — 서명 완료 자체는 이미 커밋됨) + posthog(distinctId=owner)
- `getRequestIp` 등을 `src/lib/request-meta.ts`로 추출해 기존 sign route와 공유
- **테스트 먼저**: 동의 미체크 400, 비PNG 400, RPC 에러 매핑(만료/완료/불일치 → 409·410), 레이트리밋 429

### Step 7 — 완결증명서 (감사추적 요약 PDF)
> 참고: Step 6의 완료 이메일 첨부가 이 단계의 렌더 함수를 사용하므로, 구현 순서상 `render-pdf.ts`·`certificate.ts` 추출을 Step 6 완료 이메일 작업보다 먼저 진행
- 신규 `src/components/pdf/certificate-document.tsx` (기존 contract-document 폰트·스타일 재사용): 계약 제목·ID, **doc_hash 전문**, 서명자별 블록(party·이름/이메일·시각·IP·UA·동의 항목·"이메일 링크 소유 확인" 신원확인 수준 명시), contract_events 타임라인(작성→발송→열람→상대 서명→완결), **TSA 블록**(발송·완결 토큰 유무, TSA URL, 토큰 지문 축약, `openssl ts -verify` 검증 안내 — 미확보 시 "타임스탬프 미확보" 명시), 생성 시각, 면책(과대표시 금지)
- 신규 `src/lib/contracts/certificate.ts`: 순수 매핑 (contract, signatures, requests, events) → props
- 신규 `src/app/api/contracts/[id]/certificate/route.ts` (owner, counterparty 서명 존재 시만 발급)
- 신규 `src/app/api/sign/[token]/certificate/route.ts` (상대방 교부용, 전용 DEFINER RPC `get_certificate_data(p_token_hash)` + anon 레이트리밋)
- 선택: `src/app/api/sign/[token]/pdf/route.ts` — 기존 pdf 렌더 로직을 `src/lib/contracts/render-pdf.ts`로 추출 공유, contract-document에 상대 서명 슬롯(base64 → data URI) 추가
- **테스트 먼저**: certificate.ts 순수 매핑(이벤트 정렬·서명자 2인·동의 표기·미완결 null), 미완결 시 owner route 거부

### Step 8 — 마무리: 가드 UX·표기·문서
- `deleteContract`: counterparty 서명 존재 시 사전 체크 → "맞서명이 완료된 계약은 삭제할 수 없습니다. 대신 '취소'로 무효화하세요" (트리거는 최후 방어선)
- `transitionContractStatus`: hasCounterpartySignature 조회 후 확장된 순수 함수에 전달
- 목록·상세: `sent` 배지, legalEffect 문구("기록용" / "양 당사자 동의 서명 · 이메일 소유확인 수준"), 해시 축약 노출(LEGAL §B)
- 문서: `docs/ADR.md`에 ADR-009(sent 상태·DEFINER RPC 경계·상대 서명 이미지 DB 저장 예외·삭제 차단·TSA 어댑터), `docs/LEGAL_SIGNATURE.md` §A-2/3/4/5 구현 반영 표시, `docs/DATABASE.md` 갱신

## 4. 리스크·연기 항목
1. **SECURITY DEFINER anon RPC 3~4개 = 신규 공격 표면** — 반환 필드 최소화·입력 길이 상한·search_path 고정을 리뷰 게이트로. 배포 후 Supabase advisor 재점검
2. **이메일 배달 확인(웹훅) 없음** — 실패 시 재발송 버튼으로 복구. 배달 이벤트 추적은 v3
3. **이미 signed(단독) 계약에 맞서명 추가는 범위 제외** — signed→sent 경로는 doc_hash 재동결 의미론 재정의 필요
4. **무료 공용 TSA(freeTSA.org 등)는 해외 기관** — 국내 공인 TSA(전자서명법 20조 근거) 대비 법원 관행 신뢰도는 낮음. 단 RFC 3161 표준이라 상용화 시 `TSA_URL`만 한국정보인증 등으로 교체하면 승급. 스탬프는 best-effort라 TSA 다운 시 토큰 없는 계약 존재 가능(증명서에 명시, 해시 이메일 배포가 보조 앵커)
5. **토큰 URL 전달 시 소지자 서명 가능** — 이메일 소유확인 수준의 본질적 한계. `auth_level` 확장 필드만 확보(접근 암호·휴대폰 인증은 후속)

## 5. 검증
- `npm run test` — Step별 신규 테스트 그린 (특히 embedded-postgres RPC·RLS·트리거 검증)
- `npm run build` + `npm run lint`
- dev-browser 수동 E2E: 계약 생성 → 서명하고 요청 발송(콘솔 폴백으로 링크 확보) → 시크릿 창 비로그인 서명(동의 체크 포함) → signed 전환 확인 → 완결증명서 다운로드 → 맞서명 계약 삭제 차단 확인
- TSA: dev는 noop 폴백으로 플로우 무영향 확인, `TSA_URL` 설정 후 실스탬프 1회 → 저장된 토큰을 `openssl ts -verify`로 검증
- 원격 반영: MCP `apply_migration` 수동 적용 + advisor 점검

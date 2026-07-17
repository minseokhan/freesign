# 전자서명 v2 수동 E2E 피드백 수정 계획

2026-07-17 수동 E2E(브랜치 `feat-10-signature-v2`) 피드백 7건에 대한 수정 계획.
사용자 결정: 단독 서명 제거 / PDF 양쪽 서명 모두 / TSA_URL 설정 — 모두 확정.

## 배경 진단 요약

| # | 증상 | 원인 | 분류 |
|---|------|------|------|
| 1 | sent 상태에서 "초안으로 되돌리기" 노출 | `contract-status.ts`의 `sent: ["signed","draft","canceled"]` — '철회'와 중복이면서 pending 요청을 정리 안 함 | UI/전이 규칙 |
| 2 | 맞서명 완료 후 "초안으로 되돌리기" 노출 | 상세 페이지가 `hasCounterpartySignature` ctx를 전이 목록 계산에 안 넘김 (DB는 0019에서 이미 차단) | UI 버그 |
| 3 | 타임라인에 영문 event_type 노출 | `page.tsx` `getEventDescription`이 v2 이벤트 라벨 누락 (`certificate.ts`의 `EVENT_LABELS`엔 이미 존재) | UI |
| 4 | 완결증명서 타임스탬프 "미확보" | `TSA_URL` env 미설정 → noop (정상 동작) | 설정 |
| 5 | 비로그인 수신자 증명서에 보낸 쪽 IP/UA 없음 (이메일 첨부도 동일) | owner의 `contract_signatures.meta`가 `'{}'`로 저장 + `get_certificate_data`가 `contracts.signature_meta` 미반환 → anon 경로에 폴백 없음 | DB/RPC 버그 |
| 6 | PDF에 한쪽 서명만 표시 | owner PDF 라우트가 counterparty 서명(DB base64) 미조회 / owner 서명은 Storage key뿐이라 anon RPC가 반환 불가 | 코드+스키마 |
| 7 | 단독 서명 존재 의미 약함 | 제품 결정: 제거 확정 (기존 단독 서명 계약 표시는 유지) | 제품 |

## 실행 계획

### Step 1 — 마이그레이션 0022 (5·6 DB측)
`supabase/migrations/0022_signature_v2_fixes.sql`:
- `send_signature_request_with_event` 재정의:
  - owner `contract_signatures` insert 시 `meta`에 `signature_meta`의 ip/ua 저장 (`'{}'` → `jsonb_build_object('ip',...,'ua',...)`).
  - owner 서명 이미지를 base64로도 저장: `signature_image_data` 컬럼에 기록 (counterparty와 동일 방식, ADR-009 예외 확장). 시그니처에 `p_signature_image_data text` 추가 — CHECK/길이 검증은 counterparty와 동급(256KB, PNG data URL 패턴).
- `get_certificate_data` 재정의: 반환 `contract`에 `signature_meta` 포함 (owner ip/ua 폴백용).
- `get_signed_contract_data` 재정의: `owner_signature`(name·signed_at·signature_image_data) 반환 추가.
- grant 재정렬은 0021 패턴 유지 (revoke all → 역할별 grant).
- **원격 적용**: MCP `apply_migration` 수동 실행 + `get_advisors` 확인 (git 커밋만으론 반영 안 됨).
- 검증: `src/test/__tests__/signature-rpcs.test.ts`에 owner meta·signature_image_data·RPC 반환 필드 테스트 추가(TDD) → 통과.

### Step 2 — 5번: 증명서 owner IP/UA (코드측)
- `src/lib/contracts/public-sign.ts` `parseCertificateData`: RPC 응답의 `contract.signature_meta`를 `buildCertificateProps`의 contract에 전달.
- 기존 완결 계약도 이 폴백으로 즉시 해결됨(contracts.signature_meta는 남아 있음) — backfill 불필요.
- 검증: `certificate.test.ts`·`public-sign.test.ts`에 "anon 경로에서 owner ip/ua 표기" 케이스 추가 → 통과. 이메일 첨부 경로는 동일 파서 공유로 함께 해결.

### Step 3 — 1·2번: 전이 버튼 정리
- `src/lib/contract-status.ts`:
  - `getAvailableContractStatusTransitions(from, ctx?)`로 확장 — `sent`에서는 `draft` 제외(철회로 일원화), `hasCounterpartySignature`면 `draft` 제외.
  - `forwardTransitions`의 `sent` 목록에서 `draft` 제거가 서버 전이 액션(철회 RPC 경유가 아닌 직접 전이)을 깨지 않는지 확인 — revoke RPC는 별도 함수이므로 무관해야 함.
- `src/app/(dashboard)/contracts/[id]/page.tsx`: 이미 조회 중인 `hasCounterpartySignature`를 전이 목록 계산에 전달.
- '계약 삭제' 버튼도 맞서명 완료 시 서버에서 차단되는지 확인, 안 되어 있으면 경고 문구와 일치하게 처리.
- 검증: `contract-status` 단위 테스트 추가(TDD) — sent에서 draft 미노출, counterparty 서명 시 draft 미노출 → 통과.

### Step 4 — 3번: 타임라인 라벨
- `EVENT_LABELS`를 `certificate.ts`에서 export(또는 `lib/contracts/event-labels.ts`로 추출)하고 상세 페이지 `getEventDescription`에서 공유.
- actor 표기: `counterparty:<email>` → `상대방(<email>)`, owner uuid → `소유자` 식으로 다듬기.
- viewed 이벤트("서명 대기 → 서명 대기")는 상태 화살표 대신 라벨만 표시.
- 검증: 렌더 스냅샷/단위 테스트로 라벨 매핑 확인.

### Step 5 — 6번: PDF 양쪽 서명
- owner 서식 PDF(`api/contracts/[id]/pdf`): `contract_signatures`에서 counterparty 행(signature_image_data·signer_name·signed_at) 조회 후 `mapContractPdfProps`에 `counterpartySignature` 전달 (렌더 슬롯은 기존 존재).
- 공개 PDF(`api/sign/[token]/pdf` + 이메일 첨부): `parseSignedContractData`가 Step 1의 `owner_signature`를 owner 서명 이미지로 매핑 (`signatureImageDataUri`).
- `contract-document.tsx` 레이아웃 확인: 서명 2개 나란히(보낸 쪽/상대방 라벨) 렌더.
- 기존 완결 계약: owner 이미지 base64가 없으므로 공개 PDF엔 기존처럼 메타만 — 신규 발송부터 적용(소급 없음, 사용자 합의됨).
- 검증: pdf 매핑 단위 테스트 + 수동으로 양쪽 PDF 다운로드 확인.

### Step 6 — 7번: 단독 서명 제거
- `contract-signature-tabs.tsx` 탭 제거 → `SignatureRequestForm` 단일 노출(파일 자체를 폼 직결로 대체 가능).
- draft 전이 목록에서 `signed` 직접 전이 UI 제거(간이 서명 경로였음) — `getAvailableContractStatusTransitions`는 이미 `signed`를 필터 중이므로 서명 카드 쪽만 정리.
- `SignaturePad`(단독 서명 제출 경로)와 `api/contracts/[id]/sign` 라우트: UI 진입점만 제거, 라우트·데이터는 유지(기존 단독 서명 계약 표시 위해 `signature_meta`·`signed` 상태 렌더는 그대로).
- 관련 문구 정리: "v1 간이 서명은..." 안내문 등.
- 검증: 기존 단독 서명 계약 상세가 깨지지 않는지 + draft 계약에서 요청 폼만 보이는지 E2E/수동 확인.

### Step 7 — 4번: TSA 설정 (코드 변경 없음)
- 로컬 `.env.local`에 `TSA_URL=https://freetsa.org/tsr` 추가.
- Vercel env에 동일 값 추가(사용자 확인 또는 vercel CLI).
- 검증: 새 서명 요청 발송 → 증명서에서 "발송 시점 토큰" 확보 표기 확인.

### Step 8 — 마무리
- `npm run test` / `npm run lint` / `npm run build` 그린.
- 수동 E2E: 발송 → 열람 → 서명 → 양쪽 PDF/증명서 확인 (dev-browser).
- 커밋은 step 단위 conventional commits, 원격 DB 적용 여부 메모 갱신.

## 리스크
- 0022는 RPC 시그니처 변경(`send_signature_request_with_event` 인자 추가) — 배포 순서상 DB 먼저 적용 시 구 코드가 구 시그니처를 호출하므로, **기존 함수를 drop하지 않고 새 시그니처를 추가(오버로드)하거나 코드·DB를 같은 배포로 묶을 것**. 오버로드 시 PostgREST 모호성 주의 → 기존 시그니처 유지 + 새 파라미터에 default 부여 방식 권장.
- freetsa는 공용 무료 TSA — 다운타임 있어도 best-effort라 플로우는 안 막힘.

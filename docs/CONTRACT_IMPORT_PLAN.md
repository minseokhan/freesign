# 기존 계약서 PDF 불러오기 (시나리오 B) — 구현 계획

## Context

현재 FreeSign의 계약 생성은 **시나리오 A**(프리랜서가 scope를 입력하면 AI가 10개 조항 초안을 생성)만 지원한다. 그러나 실무에서는 링크드인·에이전시·중견기업 문의의 상당수가 **시나리오 B** — 발주처가 자기네 계약서(대부분 서명된 PDF)를 먼저 보내오고, 프리랜서는 그걸 **검토·서명·기록**하는 입장 — 에 해당한다.

이 계획은 계약 진입점을 **"새 계약 작성"**(기존 A)과 **"기존 계약 불러오기"**(신규 B) 두 갈래로 나누고, B에서 업로드한 PDF를 Claude가 읽어 우리의 10개 표준 조항 카테고리(당사자·용역 범위·계약 기간·대금 및 지급·검수 및 수정·자료 제공 및 협조·비밀유지·지식재산권·해지·분쟁 해결)로 파싱하고 평문 요약을 붙여, 검토 후 계약으로 저장하는 흐름을 추가한다.

**확정된 방향** (사용자 결정):
1. 파싱 → **검토 화면에서 금액·기간·조항 확인/수정 후 저장** (AI 추출값을 사람이 확인 — 금액·지급기한은 제품의 방어 코어라 무검증 저장 금지)
2. **전체 자동 추출**: 조항 + 금액 + 계약기간 + 제목까지 AI가 추출, 사용자는 클라이언트만 선택
3. 저장되는 계약의 초기 상태는 **draft** (기존 흐름 재사용, 이후 서명/활성 전이는 기존 로직)

## 기술 접근

- **PDF 읽기**: 새 파싱 라이브러리(pdf-parse 등)를 추가하지 않고, **Claude에 document content block**(`{type:"document", source:{type:"base64", media_type:"application/pdf", data}}`)으로 PDF를 직접 읽힌다. 기존 `contract-draft.ts`의 tool_use 강제 + skeleton 폴백 패턴을 그대로 확장한다.
- **아키텍처 규칙 준수**: PDF/Claude 외부 호출은 `app/api` 라우트 + 서버 전용 모듈에서만. 쓰기는 Server Action에서만. Storage는 private 버킷 + `${user_id}/...` 경로, DB엔 key만 저장. `status·title·clauses·user_id`는 서버가 채움(client 입력 금지), 사용자는 `client_id·amount·start_date·end_date·(검토한)clauses`만 제출.
- **10개 필수 조항 제약**: 저장 검증(`contractClausesSchema`)은 10개 title이 모두 존재해야 통과한다. 파싱 결과를 **코드가 10개 슬롯으로 정규화**(누락 조항은 `needs_review=true` placeholder로 채움)해 항상 검증을 통과시킨다.

## 변경/생성 파일

### 1. DB 마이그레이션 (신규) — `supabase/migrations/0008_source_pdf.sql`
- `contracts`에 `source_pdf_url text` 컬럼 추가. (기존 `contract_pdf_url`은 FreeSign이 **생성**한 서명본 PDF용이므로, 발주처가 보낸 **원본** PDF는 별도 컬럼으로 분리해 나중에 서명본 생성 시 덮어써지지 않게 provenance 보존.)
- Storage 버킷은 기존 `contract-artifacts`(private, 5MB, `application/pdf` 허용) 재사용 — 신규 버킷/정책 불필요. 원본 경로: `${user.id}/${contractId}/source.pdf`.
- 적용 후 `src/types/database.ts`의 contracts Row/Insert/Update에 `source_pdf_url` 반영(생성 타입 재생성 또는 수기 추가).

### 2. AI 추출 서비스 (신규) — `src/services/ai/contract-import.ts` (server-only)
`contract-draft.ts`를 참고해 동일 구조로 작성:
- `extractContractFromPdf(base64Pdf): Promise<ImportedContractExtract>` — Claude `messages.create`에 document block + 지시 text + `required_clauses` 전달, `tool_choice`로 `return_imported_contract` 구조화 출력 강제.
- Tool input_schema: `{ title, scope, amount: number|null, start_date: string|null, end_date: string|null, clauses: [{title, body, plain_summary, needs_review}] }`. system 프롬프트는 "법령/판례 창작 금지, PDF에 없는 값은 null·`[검토 필요]`·needs_review=true"를 명시.
- **`normalizeImportedClauses(raw)`** (순수 함수, 이 모듈 또는 `lib/contracts/draft.ts`에 배치): AI가 반환한 조항들을 `REQUIRED_CONTRACT_CLAUSES` 10개 정확한 title 슬롯으로 매핑, 누락 title은 `{title, body:"[검토 필요]", plain_summary:"[검토 필요]", needs_review:true}`로 채움 → `contractClausesSchema` 항상 통과.
- **폴백**: Claude 실패(키 없음/파싱 실패/retry 소진) 시 title·scope·amount·dates는 빈값/null, clauses는 10개 needs_review placeholder를 반환. 검토 화면에서 사용자가 채우도록. (AI는 게이트가 아닌 보강.)
- 모델 상수 `ANTHROPIC_CONTRACT_MODEL`(claude-sonnet-5) 재사용. `AnthropicMessagesClient` 주입 인터페이스로 테스트 가능하게.

### 3. 파싱 미리보기 API (신규) — `src/app/api/contracts/import/parse/route.ts`
- `runtime="nodejs"`, `maxDuration=60`. 기존 `/api/contracts/draft/route.ts` 패턴 참고.
- `POST` FormData(파일 `file`) 수신 → `requireUser` → 파일 검증(mime `application/pdf`, ≤5MB) → base64 변환 → `extractContractFromPdf` 호출 → **DB 저장 없이** `{ extracted }` JSON 반환.
- 원본 PDF는 이 단계에서 저장하지 않는다(고아 파일 방지). 저장은 4번 Server Action에서 파일을 다시 받아 업로드.

### 4. 저장 Server Action (신규) — `src/app/(dashboard)/contracts/actions.ts`에 `createImportedContract` 추가
- 입력: FormData(원본 `file` + 검토·확정된 필드 JSON). `requireUser`.
- 신규 zod allowlist `contractImportInputSchema`로 검증: `{ client_id: uuid, title, scope, amount(coerce int positive), start_date, end_date(refine end>=start), clauses: contractClausesSchema }`. (clauses는 기존 편집 경로와 동일하게 `contractClausesSchema` 재사용 — 이미 client가 조항을 쓸 수 있는 검증된 경로가 있으므로 allowlist 원칙과 정합.)
- `assertOwned(supabase, "clients", client_id)`로 소유권 재검증(FK RLS 우회 대비).
- insert: `status:"draft"`, `user_id:user.id`, `client_id`, `title/scope/amount/start_date/end_date/clauses` → `.select("id")`.
- 원본 PDF를 `contract-artifacts` 버킷 `${user.id}/${id}/source.pdf`로 upload(upsert) → `contracts.source_pdf_url = key` update. (기존 `/api/contracts/[id]/pdf/route.ts` 업로드 패턴 재사용.)
- **provenance 이벤트 기록**: `contract_events`에 `{event_type:"contract.imported", from_status:null, to_status:"draft", actor:user.id, meta:{source:"pdf_import"}}` insert(append-only, `to_status` not-null 주의). 도메인 insert 후 이벤트 insert 순서.
- `revalidatePath("/contracts")` 후 `{ok:true, id}` 반환.

### 5. 검증 스키마 (수정) — `src/lib/validation/contract.ts`
- `contractImportInputSchema` 추가(위 4번 필드). 기존 `contractClauseSchema`/`contractClausesSchema`/`REQUIRED_CONTRACT_CLAUSES` 재사용. `ContractImportInput` 타입 export.

### 6. 불러오기 페이지 (신규) — `src/app/(dashboard)/contracts/import/page.tsx` (RSC)
- `/contracts/new/page.tsx`와 동일하게 `notDeleted`로 소유 클라이언트 목록 조회, 없으면 "클라이언트 먼저 등록" 카드. `<ContractImportForm clients={...} />` 렌더.

### 7. 불러오기 폼 (신규) — `src/components/contract-import-form.tsx` (client component)
2단계 뷰(내부 state로 전환), `contract-form.tsx`의 위저드 UX 참고:
- **1단계 업로드**: client_id select + PDF file input(≤5MB). 제출 → `/api/contracts/import/parse`에 FormData POST → 로딩 표시.
- **2단계 검토**: 추출된 title·amount·start_date·end_date를 편집 가능 필드로 pre-fill, 10개 조항을 `needs_review` 배지와 함께 목록 표시(본문/요약 인라인 수정 가능 — `contract-clauses-form.tsx` UI 참고). "저장" → 원본 File + 확정 필드를 FormData로 `createImportedContract` 호출 → 성공 시 `router.push('/contracts/${id}')`.
- 파싱 실패/빈 추출 시에도 사용자가 직접 입력해 저장 가능(폴백).

### 8. 진입점 버튼 (수정) — `src/app/(dashboard)/contracts/page.tsx`
- 헤더의 단일 "계약 만들기"(`page.tsx:104-109`)와 빈 상태 카드(`159-164`)를 **두 버튼**으로: "새 계약 작성"(→`/contracts/new`)과 "기존 계약 불러오기"(→`/contracts/import`).

## TDD (테스트 먼저)

CLAUDE.md 규칙상 순수 함수·상태전이·보안 경계는 테스트 필수. 기존 `src/app/(dashboard)/clients/__tests__/actions.test.ts` 및 계약 관련 테스트 패턴을 미러링.

1. **`normalizeImportedClauses` 순수 함수** — 신규 테스트: (a) AI가 10개를 다 주면 그대로 통과, (b) 일부 누락 시 placeholder+needs_review로 채워 `contractClausesSchema` 통과, (c) canonical이 아닌 title은 매핑/무시.
2. **`extractContractFromPdf` 폴백** — mock Anthropic client로: Claude 성공 시 파싱 결과 반환, 실패/무효 응답 시 needs_review 폴백 반환(예외 던지지 않음).
3. **`createImportedContract` Server Action** — 보안 경계: (a) 잘못된 입력 zod 거부, (b) 타 유저 client_id → `assertOwned` 실패로 거부, (c) 성공 시 `status:"draft"`·`user_id`가 서버값으로 강제되는지, (d) `contract.imported` 이벤트가 도메인 insert 후 기록되는지.

## 검증 (수동 E2E)

1. `npm run test` — 위 신규 유닛 테스트 통과.
2. `npm run build` / `npm run lint` 통과(타입: `source_pdf_url` 반영 확인).
3. dev-browser로: 로그인(test-login) → `/contracts` → "기존 계약 불러오기" → 샘플 계약 PDF 업로드 → 검토 화면에 조항 10개·금액·기간이 채워지는지 확인 → 저장 → `/contracts/{id}` 상세에서 조항·상태(draft) 확인, Storage에 원본 PDF 저장 및 `source_pdf_url` 세팅 확인.
4. 폴백 확인: 텍스트가 거의 없는/스캔 이미지 PDF로 업로드 시 needs_review placeholder로 채워지고 사용자가 수기 저장 가능한지.

## 미결/주의

- Claude document block의 정확한 SDK 페이로드 형태는 구현 시 `claude-api` 스킬/context7로 재확인(base64 PDF, media_type `application/pdf`).
- `source_pdf_url` 컬럼 추가로 `database.ts` 생성 타입 재생성 필요(supabase gen types 또는 수기).
- 스캔 이미지 PDF(텍스트 레이어 없음)는 Claude PDF 지원 범위에서 OCR까지 되나 정확도 편차 있음 — 검토 단계가 이를 흡수.

---

# 후속 변경 (2026-07-13 결정): 불러오기 계약은 서명 단계 제거

## 문제

위 초기 설계는 불러오기 계약도 `status:"draft"`로 저장하고 **기존 서명 흐름을 재사용**하기로 했다(본문 12·44행). 그런데 "기존 계약 불러오기 = 이미 성사되어 발주처가 서명본 PDF를 보낸 것"이므로, 상세 페이지가 draft 계약에 대해 띄우는 **v1 간이 서명 패드**(`contracts/[id]/page.tsx:368`)는 의미가 없다:

- 실제 증빙은 **업로드한 원본 PDF**다. 그 위에 앱의 "법적 효력 없는 기록용" 서명을 다시 그리는 건 **무의미한 이중 서명**이다.
- 무결성 해시도 "새로 그린 그림"이 아니라 **원본 PDF의 해시**여야 의미가 있다.

## 확정 방향 (사용자)

> 파일 업로드 → AI 파싱 → 항목별 검토·수정 → **저장 = 끝**. 이후엔 **인보이스 발행**만. 추가로 **원본 PDF를 보관**하고 상세에서 **원본 PDF 다운로드 버튼** 제공.

즉 불러오기 계약은 서명 패드를 거치지 않고, **저장 즉시 "성사된 계약"으로 안착**한다.

**안착 상태 = `signed`** (이 결정의 유일한 판단 지점).
- 근거: `signed`(성사)가 "계약 체결됨, 원본 PDF가 증빙"이라는 사실과 정확히 맞고, doc_hash·증빙 체인과 정합한다. `draft`(초안)로 두면 배지가 "초안"으로 뜨는 오표기가 된다.
- `signed`에서 기존 전이(→active 진행 시작 / →done / →canceled / →draft 되돌리기)와 **인보이스 발행**(`canIssueInvoice = status !== "canceled"`)이 이미 모두 가능하므로 상태머신(`lib/contract-status.ts`) 수정은 불필요하다.
- 초기 insert에서 서버가 status를 채우는 것이므로 서명 라우트의 draft→signed 게이트(`sign/route.ts:71`)를 우회하는 게 정상이다(서버 소유 필드).

## 변경 파일

### A. 서명 Provider (수정) — `src/services/signature/provider.ts`
- `SignatureProvider`에 `computeFileHash(bytes: Uint8Array): string` 추가 — 원본 PDF 바이트의 SHA-256 hex. 기존 `computeDocHash`(조항 canonical JSON 해시)와 별개.

### B. 저장 Server Action (수정) — `createImportedContract` (`contracts/actions.ts:239`)
- 저장 시점에 **원본 PDF를 필수**로 요구(현재는 best-effort로 없어도 계약 생성). 없으면 거부 — 원본이 증빙의 핵심이므로. (파싱 단계에서 이미 PDF가 있으니 정합.)
- 순서: FormData의 `file` 바이트 확보 → `computeFileHash`로 doc_hash 산출 → insert 시 `status:"signed"`, `doc_hash`, `signature_meta:{signer:user.email, signed_at:now, source:"pdf_import"}`, `signature_image_path:null` → id 확보 → `${user.id}/${id}/source.pdf` 업로드 → `source_pdf_url` update.
- provenance 이벤트: `contract_events`에 `from_status:null → to_status:"signed"`, `event_type:"contract.imported"`, `meta:{source:"pdf_import", doc_hash}` (도메인 insert 후 이벤트 insert, 순차).
- **주의**: `signed_at`에 `new Date()`를 쓰므로 서버 액션(Node)에서 산출 — 문제없음.

### C. 상세 페이지 (수정) — `contracts/[id]/page.tsx`
- select와 `ContractRow`에 `source_pdf_url` 추가. `isImported = contract.source_pdf_url != null` 판별.
- **서명 카드**: 불러오기 계약(`isImported`)에는 **서명 입력 패드를 렌더하지 않는다**. draft 여부와 무관하게, 불러오기 계약은 "원본 PDF가 증빙"임을 안내하고 원본 PDF 다운로드 + doc_hash를 보여준다. (직접 작성한 계약(`!isImported`)은 기존 서명 패드/서명 이미지 흐름 그대로 유지.)
- **원본 PDF 다운로드 버튼**: `isImported`이면 헤더의 생성 PDF 링크(`PdfLink`, `/api/contracts/[id]/pdf`) 옆에 "원본 PDF" 버튼 추가. 서빙은 신규 라우트 D 사용.

### D. 원본 PDF 라우트 (신규) — `src/app/api/contracts/[id]/source-pdf/route.ts`
- `runtime="nodejs"`. `requireUser` → 계약 소유·`source_pdf_url` 조회(RLS 스코프) → `contract-artifacts` 버킷에서 단기 signed URL 생성해 `redirect`. (읽기는 단기 signed URL 원칙 준수, key는 노출 안 함. 기존 `pdf/route.ts` 패턴 참고.)

### E. 진입/저장 후 흐름
- 불러오기 폼(`contract-import-form.tsx`)은 저장 성공 시 이미 `/contracts/{id}`로 이동 — 변경 불필요. 상세에서 곧바로 "인보이스 발행" 가능.
- (선택) 타임라인 `getEventDescription`에 `contract.imported` 라벨("기존 계약 불러오기(성사)") 추가 — 현재는 raw event_type 노출.

## TDD (테스트 먼저)

1. **`computeFileHash`** (`services/signature/__tests__/provider.test.ts`에 추가) — 동일 바이트 → 동일 hex, 알려진 벡터의 SHA-256과 일치.
2. **`createImportedContract`** (`contracts/__tests__/actions.test.ts`) — (a) 원본 PDF 없으면 거부, (b) 성공 시 `status:"signed"`·`doc_hash`(PDF 해시)·`source_pdf_url`이 서버값으로 세팅, (c) 이벤트 `to_status:"signed"`·`event_type:"contract.imported"`가 도메인 insert 후 기록, (d) 타 유저 client_id 거부(기존 케이스 유지).
3. **원본 PDF 라우트** (`source-pdf/__tests__/route.test.ts`) — 소유자면 signed URL redirect, 비소유/미존재면 404.

## 검증 (수동 E2E)

- `npm run test` / `npm run build` / `npm run lint` 통과.
- dev-browser: test-login → `/contracts/import` → PDF 업로드·파싱·검토·**저장** → 상세가 **`signed` 배지**, **서명 패드 없음**, **원본 PDF 다운로드 버튼** 노출, 문서 해시 채워짐 확인 → "인보이스 발행" 진입 확인.

## 확정 및 구현 (2026-07-13)

- 안착 상태는 **`signed`(성사)** 로 확정. 사용자가 이후 "진행 시작"으로 `active` 전이.
- 구현 완료: Provider `computeFileHash`, `createImportedContract`(PDF 필수·`signed`·PDF 해시·`contract.imported`→signed 이벤트), `GET /api/contracts/[id]/source-pdf`(원본 PDF 단기 signed URL redirect), 상세 페이지(불러오기 계약은 서명 패드 대신 원본 PDF 증빙 + 헤더 "원본 PDF" 버튼), 안내 문구 갱신.
- 검증: 신규/갱신 유닛 테스트 통과(provider·actions·source-pdf 라우트), `npm run test`(227) / `lint` / `build` 통과.

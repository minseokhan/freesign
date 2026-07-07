# Step 3: invoice-pdf

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. PDF는 `@react-pdf/renderer`·**Node 런타임 전용**(`app/api`), Storage는 private + `{user_id}/...` key만 저장·읽기는 단기 signed URL. 디렉토리(`app/api/` = PDF·시크릿 전용).
- `/docs/ADR.md` — ADR-005(PDF·문서). `/docs/UI_GUIDE.md` — 문서 레이아웃·타이포(한글)·원천징수 내역·계좌 표기.
- `/CLAUDE.md` — CRITICAL: PDF는 `app/api` 라우트 핸들러/서버 전용 모듈에서만(Node 런타임). Storage는 private + `{user_id}/...` 경로, DB엔 key만·읽기는 단기 signed URL. 시크릿·PDF는 클라이언트 직접 호출 금지.
- **phase 5 PDF 인프라(그대로 재사용 — 새로 만들지 말고 패턴 복제)**:
  - `src/app/api/contracts/[id]/pdf/route.ts` — **레퍼런스 라우트**: `export const runtime = "nodejs"`·`export const maxDuration = 30`, `requireUser()` → `assertOwned` → `notDeleted` 단건 조회 → `renderToBuffer(createElement(Document, {...}))` → Storage `upload({ upsert:true })` → DB에 key만 저장 → PDF 바이트 응답(+ `content-disposition`, `cache-control: private, no-store`).
  - `src/components/pdf/contract-document.tsx` — **레퍼런스 문서 컴포넌트**: `@react-pdf/renderer` + `Font.register`(Pretendard 한글 임베드).
  - `src/lib/contracts/pdf.ts` — `mapContractPdfProps(...)` **순수 매핑**(Row → 문서 props). 인보이스도 같은 구조로 만든다.
  - `next.config.ts` — **이미 phase 5에서 `outputFileTracingIncludes`(Pretendard 폰트) 설정됨**. 인보이스 PDF 라우트 경로도 이 트레이싱에 **포함되는지 확인**하고, 누락되면 라우트 glob을 추가하라(폰트 파일 자체는 이미 포함).
  - `public/fonts/Pretendard-Regular.ttf` — **이미 존재**. 그대로 임베드(추가 폰트 배치 불필요).
- 이전 step 산출물(실제 경로):
  - `src/app/(dashboard)/invoices/[id]/page.tsx` — 상세(PDF 버튼 배선 지점, step 0에서 자리만 둠).
  - `src/types/database.ts` — `invoices` Row(`amount`·`withholding_type`·`withholding_amount`·`net_amount`·`issue_date`·`due_date`·`payment_status`·`paid_at`), `profiles`(계좌: `bank_name`·`bank_account_number`·`bank_account_holder`).
  - `src/lib/auth.ts` `requireUser()`, `src/lib/db/index.ts` `assertOwned`/`notDeleted`, `src/lib/supabase/server.ts` `createClient()`.

**배경**: 이 step은 **phase 5에서 도입한 PDF 인프라를 재사용**해 인보이스 PDF를 만든다. 새 폰트 배치·`next.config` 대공사는 불필요 — 계약 PDF 라우트/문서/매핑 구조를 **그대로 복제**해 인보이스용으로 채운다. 인보이스 PDF는 금액·**원천징수 내역**(스냅샷)·실수령액·지급기한·입금 계좌를 담는다.

## 작업

PDF 라우트는 `app/api`(TDD 가드 경로)이지만 렌더 산출물(바이너리)은 단위 테스트가 어렵다. **문서 데이터 매핑(Row → 문서 props)** 은 순수 함수로 분리해 테스트하고, 실제 렌더·바이트는 AC(build + 라우트 200)로 검증한다. 레퍼런스: `src/lib/contracts/__tests__`(있으면), `src/app/api/contracts/[id]/pdf/__tests__/route.test.ts`.

### 1) 문서 데이터 매핑 — `src/lib/invoices/pdf.ts` 신규

- `mapInvoicePdfProps({ invoice, clientName, contractTitle, bankAccount }): InvoicePdfDocument` **순수 함수**. **저장 스냅샷을 그대로** 매핑(`amount`·`withholding_type`·`withholding_amount`·`net_amount`). **`calcWithholding` 재계산 금지**(발행 스냅샷이 진실). 원천징수액이 있으면 내역, 없으면(`none`) 생략 등 표시 규칙을 순수하게. `mapContractPdfProps` 구조를 따른다.

### 2) 문서 컴포넌트 — `src/components/pdf/invoice-document.tsx`(서버 전용)

- `@react-pdf/renderer` 컴포넌트로 인보이스 레이아웃(제목/인보이스 번호·발행일·지급기한·공급자/클라이언트·품목=계약·금액·**원천징수 내역**·실수령액·**입금 계좌**·정산 상태). **Pretendard 등록**(`Font.register`)로 한글 렌더 — `contract-document.tsx`와 동일 방식.

### 3) PDF 라우트 — `src/app/api/invoices/[id]/pdf/route.ts` 신규

- **`export const runtime = "nodejs"`**(CRITICAL — Edge 불가)·`export const maxDuration = 30`. `requireUser()` → `assertOwned(supabase, "invoices", id)` → `notDeleted` 단건 조회(FK 조인으로 `client:clients(name)`·`contract:contracts(title)`, 계좌는 `profiles`에서) → `mapInvoicePdfProps` → `renderToBuffer` → **Storage private `{user_id}/{invoice_id}/invoice.pdf`에 `upsert:true` 업로드** → DB에 **key만** 저장(적절한 컬럼이 invoices에 없으면 스키마를 새로 만들지 말고 **온디맨드 스트리밍**으로 응답하고 저장은 생략 — 재량. 저장 시엔 반드시 key만·signed URL 규칙). PDF 바이트 응답(`content-type: application/pdf`, `content-disposition: inline`, `cache-control: private, no-store`).
- 계약 PDF 라우트와 **같은 Storage 버킷 상수**를 재사용할지(예: `contract-artifacts`) 또는 인보이스 전용 버킷을 쓸지는 재량 — 단 **private 버킷 + `{user_id}/...` 경로 + key만 저장** 규칙은 필수.

### 4) 상세 UI 배선

- `src/app/(dashboard)/invoices/[id]/page.tsx`의 PDF 버튼 → PDF 라우트(다운로드/미리보기). **외과적 변경**(step 0에서 둔 placeholder만 대체).

## Acceptance Criteria

```bash
npm run build     # 인보이스 PDF 라우트(runtime nodejs)·next.config 트레이싱 포함 빌드 성공
npm run lint
npm test          # 문서 데이터 매핑 테스트 통과 + 기존 green
```

빌드 후, 가능하면 dev 서버에서 인보이스 PDF 라우트가 **한글이 깨지지 않은** PDF를 반환하는지 확인(폰트 임베드 검증).

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - PDF 라우트가 **`runtime = "nodejs"`**인가(Edge 아님)?
   - Pretendard 한글 임베드로 한글이 깨지지 않는가(계약 PDF와 동일 방식)?
   - 원천징수·금액이 **저장 스냅샷을 그대로** 표시하는가(재계산 없음)?
   - 소유권(`assertOwned`)·`user_id`를 서버에서 확인하는가?
   - Storage에 저장한다면 **private + `{user_id}/...` 경로 + key만 저장**인가(공개 URL 저장 금지)?
   - 상세 PDF 버튼이 라우트에 배선됐는가?
3. `phases/6-invoices/index.json`의 step 3을 업데이트(성공/실패/blocked). 완료 시 **phase 6 전체 완료**(execute.py가 `phases/index.json`의 `6-invoices`도 기록). Storage 버킷 등 외부 자원이 없어 진행 불가면 `blocked`+사유.

## 금지사항

- PDF를 Edge 런타임/클라이언트에서 렌더하지 마라. 이유: CRITICAL — `@react-pdf/renderer`는 Node 전용, PDF는 `app/api` Node 런타임에서만.
- 새 폰트를 배치하거나 `next.config` 폰트 트레이싱을 처음부터 다시 만들지 마라. 이유: phase 5에서 이미 `public/fonts/Pretendard-Regular.ttf` + `outputFileTracingIncludes` 설정 완료. 인보이스 라우트가 트레이싱에 포함되는지 **확인·추가만** 하라.
- 원천징수·금액을 PDF에서 `calcWithholding`로 재계산하지 마라. 이유: 발행 스냅샷이 진실(drift 방지).
- Storage 공개 URL을 DB에 저장하지 마라. 이유: private + key만·단기 signed URL 규칙.
- PDF key 저장용으로 `invoices` 스키마(마이그레이션)를 새로 만들지 마라. 이유: DB 스키마는 phase 1 소관. 컬럼이 없으면 온디맨드 스트리밍으로 응답하라.
- 기존 테스트를 깨뜨리지 마라.

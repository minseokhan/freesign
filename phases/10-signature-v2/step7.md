# Step 7: certificate-pdf

완결증명서(감사추적 요약 PDF)와 PDF 렌더 로직 공용 추출. step 8(공개 서명)의 완료 이메일 첨부가 이 step의 렌더 함수를 사용하므로 **반드시 step 8보다 먼저** 완료되어야 한다. **anon(토큰) 라우트는 이 step 범위가 아니다.**

## 읽어야 할 파일

- `/docs/SIGNATURE_V2_PLAN.md` — §2(증거 당사자 배포 행), §3 Step 7, §4 리스크 4(TSA 미확보 표기)
- `/docs/LEGAL_SIGNATURE.md` — §A-3 완결증명서 구상(담아야 할 증거 요소)
- `src/components/pdf/contract-document.tsx` — 폰트 등록·스타일·레이아웃 관례(재사용 대상)
- `src/app/api/contracts/[id]/pdf/route.ts` — **추출 원본**: 기존 계약서 PDF 렌더 로직(데이터 조회→document→스트림 응답)
- `src/lib/contracts/pdf.ts` — 기존 PDF 관련 순수 로직
- 이전 step 산출물: `supabase/migrations/0018/0019` 스키마(contract_signatures·signature_requests 컬럼·TSA 토큰 필드), `src/types/database.ts`

## 작업

### 1) 렌더 로직 추출 — 신규 `src/lib/contracts/render-pdf.ts` (server-only)

- 기존 `/api/contracts/[id]/pdf/route.ts`에서 "props → PDF Buffer" 렌더 부분을 함수로 추출:
  ```ts
  export async function renderContractPdf(props: ContractDocumentProps): Promise<Buffer>;
  export async function renderCertificatePdf(props: CertificateDocumentProps): Promise<Buffer>;
  ```
- 기존 pdf route는 추출 함수를 쓰도록 리팩토링하되 **응답 동작 불변**.
- `contract-document.tsx`에 상대 서명 슬롯 추가: props에 counterparty 서명(base64 data URI·이름·서명 시각) optional — 있으면 owner 서명 옆/아래에 표기. 기존 owner 단독 레이아웃은 불변.

### 2) 신규 `src/components/pdf/certificate-document.tsx`

contract-document의 폰트·스타일 재사용. 내용 블록(순서대로):
1. 헤더: "완결증명서(Certificate of Completion)" + 계약 제목·계약 ID·생성 시각
2. **doc_hash 전문** (SHA-256 hex 64자, 축약 금지)
3. 서명자 블록 ×2 (party별): 이름/이메일, 서명 시각, IP, User-Agent, 동의 항목(전자서명 약정·개인정보 — consent jsonb에서), **신원확인 수준 명시: "이메일 링크 소유 확인"** (과대표시 금지)
4. 타임라인: contract_events 기반 — 작성→발송→열람→상대 서명→완결 (이벤트 유형·시각)
5. **TSA 블록**: 발송·완결 토큰 각각 유무, TSA URL, 토큰 지문(sha256 축약), `openssl ts -verify -in <token.der> -data <hash> -CAfile <ca>` 형태의 검증 안내 문구. 토큰이 없으면 해당 항목에 **"타임스탬프 미확보"** 명시.
6. 면책: 이 증명서는 서비스가 기록한 감사추적 요약이며 법적 판단은 별도임을 명시.

### 3) 신규 `src/lib/contracts/certificate.ts` (순수 함수, TDD 핵심)

```ts
export function buildCertificateProps(input: {
  contract: ...; signatures: ...[]; request: ... | null; events: ...[];
}): CertificateDocumentProps | null;  // counterparty 서명 없으면 null(미완결)
```
- DB row 형태 → document props 순수 매핑: 이벤트 시각 정렬, party 정렬(owner 먼저), consent/meta jsonb 안전 파싱(누락 필드 방어), TSA 유무 플래그.

### 4) 신규 `src/app/api/contracts/[id]/certificate/route.ts` (owner용)

- `getUser()` 인가 → 소유 계약 + signatures + request + events 조회(RLS 스코프) → `buildCertificateProps` → null(미완결)이면 404/409 → `renderCertificatePdf` 스트림 응답. 기존 pdf route의 응답 헤더·에러 처리 관례를 따르라. Node 런타임 명시(기존 pdf route와 동일).

## TDD (테스트 먼저 작성)

1. `certificate.ts` 순수 매핑: 이벤트가 시각순 정렬됨, 서명자 2인 블록 생성, consent 표기 매핑, TSA 토큰 없으면 미확보 플래그, **counterparty 서명 없으면 null**
2. owner route: 미완결 계약에서 PDF 발급 거부, 비소유 접근 거부 (기존 pdf route 테스트 mock 패턴 재사용)

## Acceptance Criteria

```bash
npm run lint
npm test
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 기존 `/api/contracts/[id]/pdf` 응답 동작이 불변인가?
   - 증명서에 doc_hash 전문·신원확인 수준·TSA 미확보 표기가 있는가(과대표시 금지)?
   - 렌더가 Node 런타임 서버 전용인가?
3. 결과에 따라 `phases/10-signature-v2/index.json`의 step 7을 업데이트한다 (성공: completed+summary / 3회 실패: error+error_message / 개입 필요: blocked+blocked_reason 후 중단).

## 금지사항

- anon 토큰 라우트(`/api/sign/[token]/certificate`·`/pdf`)를 만들지 마라. 이유: step 8 소관(anon 레이트리밋·RPC와 함께).
- 증명서에 "법적 효력 보장"류 문구를 넣지 마라. 이유: 과대표시 금지 — 신원확인은 이메일 소유 확인 수준임을 정직하게 표기.
- 새 PDF 라이브러리를 추가하지 마라. 이유: @react-pdf/renderer 기존 스택 유지.
- TSA 토큰을 파싱해 시각을 추출하지 마라. 이유: 토큰은 원문 보존·외부 검증 — 증명서엔 유무·지문·검증 안내만.
- 기존 테스트를 깨뜨리지 마라.

# Step 5: contract-pdf

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. PDF는 `@react-pdf/renderer`·**Node 런타임 전용**(`app/api`에서 시크릿/PDF), Storage는 key만 저장·읽기는 단기 signed URL. 디렉토리(`app/api/` = PDF·시크릿 전용).
- `/docs/ADR.md` — ADR-005(PDF·문서), PDF 렌더 런타임 결정(있으면)
- `/docs/UI_GUIDE.md` — 문서 레이아웃·타이포(한글)
- `/CLAUDE.md` — CRITICAL: PDF는 `app/api` 라우트 핸들러/서버 전용 모듈에서만(Node 런타임). Storage는 private + `{user_id}/...` 경로, DB엔 key만·읽기는 단기 signed URL.
- 이전 step 산출물(실제 경로):
  - `src/app/(dashboard)/contracts/[id]/page.tsx` — 상세(PDF 다운로드/미리보기 버튼 연결 지점, step 0에서 자리만 둠)
  - `src/app/api/contracts/[id]/sign/route.ts` — step 4 서명 라우트(Storage 업로드·signed URL 패턴 레퍼런스)
  - `src/services/signature/provider.ts` — `doc_hash`(PDF에 무결성 해시 표기 시 참조)
  - `src/lib/supabase/server.ts` — `createClient()`(Storage), `src/lib/auth.ts` — `requireUser()`, `src/lib/db/index.ts` — `assertOwned`
  - `src/types/database.ts` — `contracts`(`contract_pdf_url`·`clauses`·`signature_image_path`·`signature_meta`)
  - `next.config.ts` — 현재 비어 있음(`const nextConfig: NextConfig = {}`). 여기에 PDF용 설정 추가.

**배경**: 이 step은 **PDF 인프라를 처음 도입**한다(`@react-pdf/renderer`·Pretendard TTF 임베드·`next.config` 트레이싱·Node 런타임). phase 6(인보이스 PDF)이 이 인프라를 재사용한다. 계약 PDF는 조항·평문요약·서명 이미지·`doc_hash`를 담는다.

## 작업

PDF 라우트는 `app/api`(TDD 가드 경로)이지만 렌더 산출물(바이너리)은 단위 테스트가 어렵다. **PDF 문서 구성(순수 데이터 → 문서 모델)** 부분은 가능한 한 테스트하고, 실제 렌더·바이트는 AC(build + 라우트 200)로 검증한다.

### 1) 의존성·런타임 설정

- `@react-pdf/renderer` 설치(package.json). **Pretendard TTF** 폰트 파일을 `public/fonts/`(또는 서버가 읽을 경로)에 두고 **한글 전 영역 임베드**(부분 서브셋으로 한글 깨짐 금지).
- `next.config.ts`: **`outputFileTracingIncludes`**로 PDF 라우트에 폰트/필요 wasm을 포함(서버리스 번들 누락 방지) + PDF 라우트 **`maxDuration`** 상향(렌더 시간 확보).

### 2) PDF 라우트 — `src/app/api/contracts/[id]/pdf/route.ts`

- **`export const runtime = "nodejs"`**(CRITICAL — `@react-pdf/renderer`는 Node 전용, Edge 불가). `requireUser()` 인가 → 대상 계약 소유·조회(`assertOwned`) → `clauses`·서명 정보로 PDF 렌더 → 응답.
- **저장 전략**: 렌더한 PDF를 Storage(private `{user_id}/{contract_id}/contract.pdf`)에 업로드하고 `contracts.contract_pdf_url`에 **key만** 저장, 읽기는 **단기 signed URL**. (또는 온디맨드 스트리밍 — 재량이나 Storage 저장 시 key만·signed URL 규칙 준수.)
- 서명 이미지가 필요하면 step 4의 `signature_image_path` key로 Storage에서 읽어 임베드.

### 3) PDF 문서 컴포넌트 — `src/components/pdf/contract-document.tsx`(서버 전용)

- `@react-pdf/renderer` 컴포넌트로 계약 문서 레이아웃(제목·당사자·조항 본문·평문요약·서명 이미지·`doc_hash` 무결성 표기·v1 면책). **Pretendard 등록**(`Font.register`)로 한글 렌더.

### 4) 상세 UI 배선

- `src/app/(dashboard)/contracts/[id]/page.tsx`의 PDF 버튼 → PDF 라우트(다운로드/미리보기). signed URL로 접근. **외과적 변경**.

### 5) 테스트

- PDF 문서에 넘길 **데이터 매핑(계약 Row → 문서 props)**이 순수 함수라면 그 부분을 테스트(조항 누락·해시 표기). 바이너리 렌더 자체는 AC(build)로.

## Acceptance Criteria

```bash
npm run build     # PDF 라우트(runtime nodejs)·next.config 트레이싱 포함 빌드 성공
npm run lint
npm test          # 기존 green (+ 문서 데이터 매핑 테스트가 있으면 통과)
```

빌드 후, 가능하면 dev 서버에서 서명된 계약의 PDF 라우트가 **한글이 깨지지 않은** PDF를 반환하는지 확인(폰트 임베드 검증).

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - PDF 라우트가 **`runtime = "nodejs"`**인가(Edge 아님)?
   - `next.config`에 **`outputFileTracingIncludes`(폰트/wasm)** + `maxDuration`이 설정됐는가?
   - **Pretendard TTF 한글 전 영역 임베드**로 한글이 깨지지 않는가?
   - PDF를 Storage에 저장한다면 **key만 저장·읽기는 단기 signed URL**인가?
   - 소유권·`user_id`를 서버에서 확인하는가?
   - PDF에 조항·평문요약·`doc_hash`·**v1 면책**이 포함되는가?
3. `phases/5-contracts/index.json`의 step 5를 업데이트(성공/실패/blocked). 완료 시 **phase 5 전체 완료** — 필요 시 `phases/index.json`의 `5-contracts`도 execute.py가 `completed`로 기록. **Pretendard TTF·Storage 버킷 등 외부 자원이 없어 진행 불가면** `blocked`+사유(수동 폰트 배치·버킷 프로비저닝).

## 금지사항

- PDF를 Edge 런타임이나 클라이언트에서 렌더하지 마라. 이유: CRITICAL — `@react-pdf/renderer`는 Node 전용, PDF는 `app/api` Node 런타임에서만.
- 한글 폰트를 부분 서브셋만 임베드하거나 시스템 폰트에 의존하지 마라. 이유: 서버리스에서 한글 깨짐. TTF 전 영역 임베드 필수.
- `next.config`의 `outputFileTracingIncludes`를 빠뜨리지 마라. 이유: 폰트/wasm이 서버 번들에서 누락돼 런타임 실패.
- Storage 공개 URL을 DB에 저장하지 마라. 이유: private + key만·단기 signed URL 규칙.
- 인보이스 PDF를 만들지 마라. 이유: phase 6 소관(이 인프라를 재사용).
- 기존 테스트를 깨뜨리지 마라.

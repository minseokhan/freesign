# Step 6: docs-update

## 읽어야 할 파일

먼저 아래 파일들을 읽고, 이번 phase(기존 계약 PDF 불러오기 = 시나리오 B)에서 **실제로 구현된 것**을 파악한 뒤 문서를 갱신하라:

- `/docs/CONTRACT_IMPORT_PLAN.md` — 이번 phase 기획 전체.
- 이전 step 산출물(실제 구현):
  - `supabase/migrations/0008_source_pdf.sql` (신규 `source_pdf_url` 컬럼)
  - `src/services/ai/contract-import.ts`, `src/lib/contracts/draft.ts`(normalizeImportedClauses)
  - `src/app/api/contracts/import/parse/route.ts`
  - `src/app/(dashboard)/contracts/actions.ts`(`createImportedContract`)
  - `src/app/(dashboard)/contracts/import/page.tsx`, `src/components/contract-import-form.tsx`
- 갱신 대상 문서: `/docs/ARCHITECTURE.md`, `/docs/PRD.md`, `/AGENTS.md`.

## 작업

**원칙: 실제 구현과 일치하는 최소한의 사실만 반영한다. 추측·미구현 기능·과장 금지. 기존 문서 스타일·포맷을 그대로 따른다.**

### 1) `docs/ARCHITECTURE.md`

- **라우트 표**(현재 `/contracts/new`, `/contracts/[id]` 등이 나열된 표)에 두 줄 추가:
  - `/contracts/import` — 기존 계약 PDF 불러오기 (업로드 → Claude 추출 → 검토 → draft 저장)
  - `/api/contracts/import/parse` — 업로드 PDF를 Claude로 파싱해 추출 결과 미리보기 반환 (저장 없음, nodejs 런타임)
  - 기존 `/contracts/new` 행 설명에 "= 시나리오 A(AI 초안 생성)" 뉘앙스가 있으면 그대로 두고, import는 "= 시나리오 B(기존 계약 검토·기록)"로 대비되게 표기.
- **contracts 모델**에서 컬럼을 나열한 곳이 있으면 `source_pdf_url`(발주처 원본 PDF의 Storage key, 매듭 생성 서명본 `contract_pdf_url`과 분리)을 추가한다.
- **시크릿·외부 API** 규칙 문단에 Claude PDF 추출(`contract-import.ts`)이 서버 전용 모듈 + `api` 라우트에서만 호출됨을 필요 시 한 줄 보강(이미 일반화돼 있으면 생략).

### 2) `docs/PRD.md`

- 계약서 작성 기능 설명에 **시나리오 B(기존 계약 불러오기)** 를 한 문단/불릿으로 추가한다: 발주처가 보낸 PDF를 업로드하면 Claude가 10개 표준 조항·금액·기간·제목을 추출하고, 사용자가 검토·수정 후 draft로 저장한다. AI 추출값은 사람이 검토(금액·지급기한은 방어 코어라 무검증 저장 금지), AI 실패 시 수기 입력 폴백. 기존 PRD의 톤/구조에 맞춘다.

### 3) `AGENTS.md`

- "기술 스택" 또는 "아키텍처 규칙"에서 Claude API 용도가 "계약서 초안"으로만 적혀 있으면, "계약서 초안 **및 기존 계약 PDF 조항 추출(시나리오 B)**"로 보강한다.
- 필요 시 AI 관련 CRITICAL 규칙(초안·추출 모두 비권위적, 사람 검토 게이트, 실패 시 폴백)이 추출에도 적용됨을 한 줄로 명확히 한다. **새 규칙을 창작하지 말고** 기존 규칙의 적용 범위만 넓힌다.

## Acceptance Criteria

```bash
npm run lint       # 문서만 바뀌면 통과(코드 변경 없음 확인)
npm test           # 기존 테스트 green
git diff --stat    # docs/ARCHITECTURE.md, docs/PRD.md, AGENTS.md 만 변경됐는지 확인
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 변경이 **문서 3개 파일에 국한**되고 코드/테스트는 건드리지 않았는가?
   - 문서 내용이 실제 구현(라우트 경로, 컬럼명, 동작)과 정확히 일치하는가(허구 경로·미구현 기능 없음)?
   - 기존 문서 스타일·표 포맷을 따랐는가?
3. 결과에 따라 `phases/9-contract-import/index.json`의 step 6을 업데이트한다.

## 금지사항

- 미구현 기능이나 추측성 로드맵을 문서에 넣지 마라. 이유: 문서는 실제 구현과 일치해야 한다.
- 코드·테스트·마이그레이션 파일을 수정하지 마라. 이유: 이 step은 문서 갱신 전용.
- 기존 문서를 대규모로 재작성하지 마라. 이유: 외과적 변경 — import 기능 관련 사실만 추가/보강.
- 기존 테스트를 깨뜨리지 마라.

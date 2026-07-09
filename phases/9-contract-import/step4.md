# Step 4: import-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 UI 패턴·설계 의도를 파악하라:

- `/docs/CONTRACT_IMPORT_PLAN.md` — "변경/생성 파일 §6·§7". 2단계 뷰(업로드 → 검토) UX.
- `/docs/UI_GUIDE.md` — 폼·배지·카드 규격. `needs_review` 배지 표현.
- `/CLAUDE.md` — 읽기는 RSC 직접 조회. 쓰기는 Server Action.
- `src/app/(dashboard)/contracts/new/page.tsx` — **1차 레퍼런스(페이지)**. `notDeleted`로 소유 클라이언트 목록 조회, 없으면 "클라이언트 먼저 등록" 카드, `<ContractForm clients={...} />` 렌더 패턴. 이걸 그대로 미러링해 import 페이지를 만든다.
- `src/components/contract-form.tsx` — **1차 레퍼런스(폼)**. client component, 위저드/단계 전환, Server Action 호출, 로딩/에러 표시, `router.push` 성공 이동 패턴.
- `src/components/contract-clauses-form.tsx` — 10개 조항을 본문/요약 인라인 편집하는 UI. import 검토 단계의 조항 편집에 이 UI 패턴을 재사용/참고.
- step 2 산출물 `src/app/api/contracts/import/parse/route.ts` — 응답 형태 `{ extracted: ImportedContractExtract }`.
- step 3 산출물 `src/app/(dashboard)/contracts/actions.ts`의 `createImportedContract(formData)` — FormData(`file` + `payload` JSON) 계약.
- `src/services/ai/contract-import.ts` — `ImportedContractExtract` 타입(클라이언트에서 **타입만** import — 서버 모듈 값 import 금지, 필요 시 타입을 `types/`로 분리하거나 `import type`).

## 작업

### 1) 불러오기 페이지 신규 — `src/app/(dashboard)/contracts/import/page.tsx` (RSC)

- `new/page.tsx`와 동일하게 RSC에서 `notDeleted`로 소유 클라이언트 목록(`id,name`)을 조회한다.
- 클라이언트가 0건이면 "클라이언트 먼저 등록" 안내 카드(new/page.tsx와 동일 문구/패턴).
- 있으면 `<ContractImportForm clients={clients} />` 렌더.
- (dashboard) 레이아웃 가드가 인가를 덮으므로 page에 `requireUser()` 중복 금지.

### 2) 불러오기 폼 신규 — `src/components/contract-import-form.tsx` (client component)

- `"use client"`. props: `{ clients: { id: string; name: string }[] }`.
- 내부 state로 **2단계 뷰** 전환:
  - **1단계(업로드)**: `client_id` select + PDF `file` input(accept `application/pdf`, 5MB 초과 시 클라이언트단 안내). "분석" 제출 → 선택 파일을 FormData(`file`)로 `POST /api/contracts/import/parse` → 로딩 스피너 → 응답 `extracted`를 state에 저장하고 2단계로 전환. 파싱 실패(네트워크/500) 시 사용자에게 알리고, **빈 추출로 2단계 진행 가능**하게(폴백 수기 입력).
  - **2단계(검토)**: `extracted`의 `title/amount/start_date/end_date`를 **편집 가능 필드로 pre-fill**(null이면 빈값). 10개 조항을 목록으로 표시하되 `needs_review=true`인 조항엔 **"검토 필요" 배지**를 붙이고 본문/요약을 인라인 편집 가능하게(`contract-clauses-form.tsx` UI 참고). "저장" → 1단계에서 고른 원본 File + 확정 필드를 FormData(`file` + `payload` JSON)로 만들어 `createImportedContract(formData)` 호출 → 성공 시 `router.push('/contracts/' + id)`, 실패 시 `fieldErrors`/`error` 표시.
- 원본 File은 1단계 선택 후 컴포넌트 state(또는 ref)에 보관해 2단계 저장 시 재사용한다(파싱 API는 저장하지 않으므로 저장 단계에서 파일을 다시 보내야 함).
- 파싱 실패/빈 추출이어도 사용자가 모든 필드를 직접 입력해 저장할 수 있어야 한다(폴백).

## Acceptance Criteria

```bash
npm run lint
npm run build      # /contracts/import 페이지·폼이 컴파일
npm test           # 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 페이지가 **RSC 직접 조회**(내부 `/api` fetch 없음)이고 `notDeleted`를 쓰는가?
   - 폼이 서버 모듈(`contract-import.ts`)의 **값이 아닌 타입만** import하는가(`import type`)?
   - 파싱 실패/빈 추출 시에도 수기 입력·저장이 가능한가(폴백)?
   - 저장 시 원본 File을 다시 FormData로 보내는가(파싱 API는 저장 안 함)?
   - `needs_review` 조항에 배지가 표시되는가?
3. 결과에 따라 `phases/9-contract-import/index.json`의 step 4를 업데이트한다.

## 금지사항

- 페이지에서 읽기를 내부 `/api` fetch로 우회하지 마라. 이유: CRITICAL — 읽기는 RSC 직접 조회.
- 클라이언트 컴포넌트에서 `contract-import.ts`의 함수(값)를 import하지 마라. 이유: server-only 모듈. 타입만 `import type`으로.
- 진입점 버튼(`contracts/page.tsx`)은 이 step에서 수정하지 마라. 이유: step 5 소관.
- 새 UI 라이브러리를 추가하지 마라. 이유: 기존 shadcn/ui 프리미티브 재사용.
- 기존 테스트를 깨뜨리지 마라.

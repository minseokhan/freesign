# Step 1: ai-import-service

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라. **이 step은 `contract-draft.ts`의 구조를 미러링**한다:

- `/docs/CONTRACT_IMPORT_PLAN.md` — "기술 접근"과 "변경/생성 파일 §2". 특히 Claude document content block으로 PDF를 직접 읽히는 접근, 10개 슬롯 정규화, 폴백 원칙.
- `/CLAUDE.md` — 시크릿·외부 API는 서버 전용 모듈에서만. AI는 필수 게이트가 아닌 보강(실패 시 골격 폴백).
- `src/services/ai/contract-draft.ts` — **1차 레퍼런스**. `AnthropicMessagesClient` 주입 인터페이스, tool_choice 강제, `parseClaudeDraft` 방어적 파싱, retry+backoff, 키 없음/예외 시 skeleton 폴백 패턴을 그대로 따른다.
- `src/lib/validation/contract.ts` — `REQUIRED_CONTRACT_CLAUSES`(10개 정확한 title), `contractClauseSchema`(title/body/plain_summary min(1) + needs_review boolean), `contractClausesSchema`(10개 title 모두 존재 검증).
- `src/lib/contracts/draft.ts` — `toContractClauses`가 10개 title 슬롯을 만드는 방식 참고(정규화 패턴의 힌트).
- `src/lib/env.ts` — `getServerEnv()`로 `ANTHROPIC_API_KEY` 접근.
- `claude-api` 스킬 또는 context7로 Anthropic SDK의 **document content block** 정확한 페이로드를 재확인하라: `{ type: "document", source: { type: "base64", media_type: "application/pdf", data: <base64string> } }`를 user message content 배열에 text 지시와 함께 넣는다.

**중요**: 새 PDF 파싱 라이브러리(pdf-parse 등)를 추가하지 마라. Claude에 PDF를 직접 읽힌다.

## 작업

### 1) 순수 함수 `normalizeImportedClauses` — `src/lib/contracts/draft.ts`에 추가 (TDD 대상)

- 시그니처: `export function normalizeImportedClauses(raw: unknown): ContractClauseInput[]`
- 동작: AI가 반환한 임의의 조항 배열을 `REQUIRED_CONTRACT_CLAUSES` 10개 **정확한 title 슬롯**으로 매핑한다.
  - 각 required title에 대해, raw에서 동일 title을 가진 항목을 찾으면 그 `body`/`plain_summary`/`needs_review`를 사용한다(단, body·plain_summary가 빈 문자열이면 `"[검토 필요]"`로 대체, needs_review는 true로).
  - 매칭되는 항목이 없으면 `{ title, body: "[검토 필요]", plain_summary: "[검토 필요]", needs_review: true }` placeholder로 채운다.
  - canonical 10개에 없는 title은 **무시**한다(결과는 항상 정확히 10개, `contractClausesSchema` 순서·title 검증 통과).
- 반환 타입은 `contractClausesSchema`를 통과하는 형태여야 한다(`ContractClauseInput`을 `@/lib/validation/contract`에서 import).

### 2) AI 추출 서비스 신규 — `src/services/ai/contract-import.ts` (server-only)

`contract-draft.ts`와 동일 구조:

- 파일 최상단에 `// server-only` 주석. `ANTHROPIC_CONTRACT_MODEL`은 `contract-draft.ts`에서 import해 재사용(중복 선언 금지).
- 타입:
  ```ts
  export interface ImportedContractExtract {
    title: string | null;
    scope: string | null;
    amount: number | null;
    start_date: string | null;
    end_date: string | null;
    clauses: ContractClauseInput[]; // 항상 정규화된 10개
    source: "ai" | "fallback";
  }
  ```
- `AnthropicMessagesClient` 인터페이스는 `contract-draft.ts`와 동일 형태로 이 모듈에도 정의(또는 import). 테스트 주입 가능하게.
- 함수:
  ```ts
  export async function extractContractFromPdf(
    base64Pdf: string,
    options?: { client?: AnthropicMessagesClient; retryCount?: number; backoffMs?: number },
  ): Promise<ImportedContractExtract>
  ```
  - Claude `messages.create`에 **document block(base64 PDF) + 지시 text + `required_clauses`** 를 전달하고, `tool_choice: { type: "tool", name: "return_imported_contract" }`로 구조화 출력을 강제한다.
  - tool `input_schema`(properties): `title(string)`, `scope(string)`, `amount(number|null → JSON schema는 `["number","null"]`)`, `start_date(string|null)`, `end_date(string|null)`, `clauses`(array of `{title, body, plain_summary, needs_review}`).
  - system 프롬프트: "법령/판례/근거 창작 금지. PDF에 실제로 없는 값은 title/scope는 빈 문자열이 아니라 `null`, 날짜·금액은 `null`, 조항 본문은 `[검토 필요]`·needs_review=true로 표기. 출력은 항상 비권위적 추출 결과."
  - 응답 파싱은 `contract-draft.ts`의 `parseClaudeDraft`처럼 방어적으로(zod safeParse). tool_use 블록에서 input을 꺼내 zod로 검증.
  - **성공 시**: 파싱된 값에 `normalizeImportedClauses(parsed.clauses)`를 적용해 clauses를 10개로 정규화하고 `source: "ai"`로 반환.
  - **폴백**(키 없음/예외/retry 소진/무효 응답): `{ title: null, scope: null, amount: null, start_date: null, end_date: null, clauses: normalizeImportedClauses([]), source: "fallback" }` 반환. **예외를 던지지 않는다.**
  - retry+backoff는 `contract-draft.ts`와 동일 패턴(기본 retryCount 2, backoff 150ms).

## TDD (테스트 먼저 작성)

`src/services/ai/__tests__/` 또는 기존 테스트 위치 관례를 따라 작성. 기존 `contract-draft` 테스트가 있으면 그 패턴을 미러링하라.

1. **`normalizeImportedClauses`** (`src/lib/contracts/__tests__/draft.test.ts` 또는 기존 파일에 추가):
   - (a) AI가 10개 canonical title을 다 주면 그대로 통과하고 `contractClausesSchema.parse`가 성공한다.
   - (b) 일부 title 누락 시 placeholder+needs_review로 채워지고 결과가 정확히 10개이며 `contractClausesSchema.parse` 통과.
   - (c) canonical이 아닌 title(예: "잡담")은 결과에서 제외된다.
2. **`extractContractFromPdf` 폴백**: mock `AnthropicMessagesClient`로:
   - Claude가 유효한 tool_use를 반환하면 파싱 결과(`source: "ai"`, 10개 clauses)를 반환.
   - Claude가 throw하거나 무효 응답이면 폴백(`source: "fallback"`, 10개 needs_review clauses)을 **예외 없이** 반환.

## Acceptance Criteria

```bash
npm run lint
npm test           # 위 신규 테스트 포함 green
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `contract-import.ts`가 `// server-only`이고 클라이언트 컴포넌트에서 import되지 않는가?
   - `extractContractFromPdf`가 **예외를 던지지 않고** 항상 10개 정규화 clauses를 반환하는가?
   - `normalizeImportedClauses` 결과가 `contractClausesSchema`를 항상 통과하는가?
   - 새 PDF 파싱 라이브러리를 추가하지 않았는가(package.json 확인)?
3. 결과에 따라 `phases/9-contract-import/index.json`의 step 1을 업데이트한다.

## 금지사항

- pdf-parse 등 PDF 파싱 라이브러리를 추가하지 마라. 이유: Claude document block으로 직접 읽는 것이 이 phase의 확정 접근.
- `extractContractFromPdf`에서 예외를 던지지 마라. 이유: AI는 게이트가 아닌 보강 — 실패 시 폴백을 반환해 사용자가 수기 저장하게 한다.
- DB 저장·Server Action·API 라우트·UI를 만들지 마라. 이유: 각각 step 2~5 소관. 이 step은 순수 함수 + AI 서비스 모듈만.
- `service_role` 키를 사용하지 마라. 이유: 이 모듈은 Claude 호출만 하며 DB 접근 없음.
- 기존 테스트를 깨뜨리지 마라.

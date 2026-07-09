# Step 2: parse-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/CONTRACT_IMPORT_PLAN.md` — "변경/생성 파일 §3". 파싱 미리보기 API는 **DB 저장 없이** 추출 결과만 반환한다(고아 파일 방지, 저장은 step 3 Server Action).
- `/CLAUDE.md` — 시크릿·외부 API는 `app/api/` 라우트에서만. 서버 인가는 `getUser()`.
- `src/app/api/contracts/draft/route.ts` — **1차 레퍼런스**. `runtime`·`maxDuration`·`requireUser`·에러 응답 패턴을 그대로 따른다.
- `src/services/ai/contract-import.ts` — step 1 산출물. `extractContractFromPdf(base64Pdf, options?)` 시그니처와 `ImportedContractExtract` 반환 타입.
- `src/lib/auth.ts` — `requireUser()` 사용법.

## 작업

### 파싱 미리보기 API 신규 — `src/app/api/contracts/import/parse/route.ts`

- 라우트 세그먼트 옵션: `export const runtime = "nodejs";` `export const maxDuration = 60;`
- `export async function POST(request: Request)`:
  1. `const user = await requireUser();` (인가만; user 값 미사용이어도 인가 게이트로 호출).
  2. `const formData = await request.formData();` 에서 `file` 필드(File)를 꺼낸다.
  3. **파일 검증**: `file`이 없거나 File이 아니면 400. `file.type !== "application/pdf"`면 415(또는 400) `{ error: "PDF 파일만 업로드할 수 있습니다." }`. `file.size > 5 * 1024 * 1024`(5MB)면 413(또는 400) `{ error: "5MB 이하 PDF만 업로드할 수 있습니다." }`.
  4. `const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");`
  5. `const extracted = await extractContractFromPdf(base64);`
  6. **DB 저장·Storage 업로드 없이** `return NextResponse.json({ extracted });` 반환.
- 예외 방어: `extractContractFromPdf`는 폴백을 반환하므로 정상 흐름에서 throw하지 않지만, 파일 파싱(arrayBuffer) 등에서의 예외는 `try/catch`로 500 `{ error }` 처리.

## Acceptance Criteria

```bash
npm run lint
npm run build      # 라우트가 컴파일
npm test           # 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `runtime="nodejs"`·`maxDuration=60`이 선언됐는가?
   - `requireUser()`로 인가하는가(`getSession` 아님)?
   - mime `application/pdf` + 5MB 상한을 검증하는가?
   - **DB insert·Storage upload를 하지 않는가**(이 라우트는 미리보기 전용)?
   - 응답이 `{ extracted }` JSON인가?
3. 결과에 따라 `phases/9-contract-import/index.json`의 step 2를 업데이트한다.

## 금지사항

- 이 라우트에서 DB insert나 Storage upload를 하지 마라. 이유: 저장은 step 3의 Server Action에서 파일을 다시 받아 처리한다(고아 파일 방지, 계획 §3).
- 쓰기(계약 생성)를 이 라우트에서 하지 마라. 이유: CRITICAL — 쓰기는 Server Action에서만.
- `service_role` 키를 사용하지 마라. 이유: 요청 경로에서 금지.
- 기존 테스트를 깨뜨리지 마라.

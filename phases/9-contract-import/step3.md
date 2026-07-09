# Step 3: import-action

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라. **보안 경계 step이므로 특히 꼼꼼히 읽어라**:

- `/docs/CONTRACT_IMPORT_PLAN.md` — "변경/생성 파일 §4·§5". allowlist·소유권 재검증·서버 소유 필드·provenance 이벤트 규칙.
- `/CLAUDE.md` — CRITICAL: 쓰기는 Server Action에서만. Server Action은 **client 입력 전용 zod allowlist**(도메인 필드만), `user_id`는 항상 `getUser()`, 서버 소유 필드(`status`·`doc_hash` 등)는 client 입력 금지. FK 참조는 **소유권 재조회 검증 후 insert**. 상태 전이는 **도메인 UPDATE/INSERT 후 이벤트 INSERT 순차**.
- `src/app/(dashboard)/contracts/actions.ts` — **1차 레퍼런스**. `createContractDraft`의 `requireUser`→zod 검증→`assertOwned`→insert(`status:"draft"`, `user_id`, `client_id` 서버 주입)→`.select("id")`→`revalidatePath` 순서, `ContractActionResult` 타입, `contract_events` insert 패턴을 그대로 따른다.
- `src/lib/validation/contract.ts` — `contractClausesSchema`(재사용), `contractDraftInputSchema`(참고), `REQUIRED_CONTRACT_CLAUSES`.
- `src/app/api/contracts/[id]/pdf/route.ts` — `contract-artifacts` 버킷 Storage **업로드 패턴**(`.storage.from(BUCKET).upload(key, buffer, { contentType, upsert:true })` 후 `contracts` update)을 그대로 참고.
- `src/lib/contracts/draft.ts` — step 1에서 추가한 `normalizeImportedClauses`(clauses 정규화가 이미 됐다면 재정규화 불필요, 하지만 방어적으로 재검증은 zod가 담당).
- `src/lib/db/index.ts` — `assertOwned(supabase, table, id)` 헬퍼.
- 기존 보안 경계 테스트: `src/app/(dashboard)/contracts/__tests__/` 또는 `clients/__tests__/actions.test.ts` 패턴을 미러링.

## 작업

### 1) 검증 스키마 추가 — `src/lib/validation/contract.ts`

- `contractImportInputSchema` 추가:
  ```ts
  export const contractImportInputSchema = z
    .object({
      client_id: z.string().uuid(),
      title: z.string().trim().min(1),
      scope: z.string().trim().min(1),
      amount: z.coerce.number().int().positive(),
      start_date: dateSchema,
      end_date: dateSchema,
      clauses: contractClausesSchema,
    })
    .refine((v) => v.end_date >= v.start_date, {
      message: "종료일은 시작일보다 빠를 수 없습니다.",
      path: ["end_date"],
    });
  export type ContractImportInput = z.infer<typeof contractImportInputSchema>;
  ```
  - 기존 `dateSchema`·`contractClausesSchema`·`REQUIRED_CONTRACT_CLAUSES`를 재사용한다(중복 정의 금지).

### 2) 저장 Server Action 추가 — `src/app/(dashboard)/contracts/actions.ts`에 `createImportedContract`

- 시그니처: `export async function createImportedContract(formData: FormData): Promise<ContractActionResult>`
- 흐름(순서 엄수):
  1. `const user = await requireUser();`
  2. FormData에서 원본 `file`(File)과 확정 필드 JSON을 꺼낸다. 필드는 `file` + 나머지 도메인 필드를 담은 `payload`(JSON 문자열) 형태로 받는다(폼과 계약된 형식; 폼 step에서 동일하게 보냄). `JSON.parse` 실패 시 검증 에러 반환.
  3. `contractImportInputSchema.safeParse(parsedPayload)` — 실패 시 `validationError`(기존 헬퍼 재사용).
  4. `const owned = await assertOwned(supabase, "clients", parsed.client_id);` — 실패 시 `{ ok:false, error:"클라이언트를 찾을 수 없습니다." }`. **FK RLS 우회 대비 소유권 재검증 필수.**
  5. **도메인 insert**: `status:"draft"`, `user_id:user.id`(서버값), `client_id`, `title/scope/amount/start_date/end_date`, `clauses`(as Json) → `.select("id").single()`. `status`·`user_id`는 **절대 client 입력에서 받지 않는다**.
  6. **원본 PDF 업로드**: file이 존재하고 유효한 PDF면(`type==="application/pdf"`, `size<=5MB`) `contract-artifacts` 버킷에 `${user.id}/${id}/source.pdf` 키로 upload(upsert:true) → 성공 시 `contracts.source_pdf_url = key` update. 업로드 실패는 계약 저장을 롤백하지 않되 에러를 로깅/무시(계약 draft는 이미 저장됨; provenance는 best-effort). **단, file이 없거나 무효면 업로드를 건너뛰고 계약만 저장**(폴백 저장 허용).
  7. **provenance 이벤트 INSERT**(도메인 insert **후** 순차): `contract_events`에 `{ user_id:user.id, contract_id:id, actor:user.id, from_status:null, to_status:"draft", event_type:"contract.imported", meta:{ source:"pdf_import" } }`. `to_status`는 not-null이므로 반드시 `"draft"`.
  8. `revalidatePath("/contracts");` 후 `{ ok:true, id }` 반환.
- 반환 타입은 기존 `ContractActionResult` 재사용. `dbError`/`validationError` 헬퍼 재사용.

## TDD (테스트 먼저 작성)

기존 계약 Server Action 테스트 패턴을 미러링. Supabase 클라이언트는 기존 테스트가 mock하는 방식과 동일하게 처리:

1. **입력 검증**: 잘못된 입력(빈 title, 음수 amount, end<start, clauses 10개 미만/누락 title)은 zod로 거부되고 `ok:false`.
2. **소유권 경계**: 타 유저의 `client_id`(=`assertOwned` false)면 insert 없이 거부.
3. **서버 소유 필드 강제**: 성공 경로에서 insert payload의 `status`가 `"draft"`, `user_id`가 `user.id`로 들어가는지(설령 payload에 다른 status/user_id를 넣어도 무시되는지) 확인.
4. **이벤트 순서**: `contract.imported` 이벤트가 **도메인 contracts insert 후**에 기록되는지(insert 호출 순서 검증).

## Acceptance Criteria

```bash
npm run lint
npm test           # 위 신규 보안 경계 테스트 포함 green
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `status`·`user_id`가 **서버값으로 강제**되고 client 입력에서 받지 않는가?
   - `assertOwned`로 client_id 소유권을 **재검증**하는가(FK RLS 우회 대비)?
   - 도메인 insert **후** 이벤트 insert가 순차인가(부분 실패 시 미완 방지)?
   - 원본 PDF가 `${user.id}/${id}/source.pdf`로 업로드되고 `source_pdf_url`에 **key만** 저장되는가(signed URL 아님)?
   - file이 없어도(폴백) 계약이 저장되는가?
3. 결과에 따라 `phases/9-contract-import/index.json`의 step 3을 업데이트한다.

## 금지사항

- `status`·`user_id`·`source_pdf_url`을 client 입력(payload)에서 받지 마라. 이유: CRITICAL — 서버 소유 필드는 client 입력 금지.
- 소유권 재검증 없이 `client_id`를 insert하지 마라. 이유: FK는 RLS를 우회하므로 `assertOwned` 필수.
- 이벤트 INSERT를 도메인 insert보다 앞에 두지 마라. 이유: 부분 실패 시 상태 이벤트만 남는 미완 방지.
- 원본 PDF의 signed URL이나 public URL을 DB에 저장하지 마라. 이유: DB엔 Storage key만 저장, 읽기는 단기 signed URL.
- 기존 테스트를 깨뜨리지 마라.

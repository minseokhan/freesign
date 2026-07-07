# Step 1: contract-create-ai

## 읽어야 할 파일

- `/docs/PRD.md` — 기능2(AI 계약서 초안). **AI는 필수 게이트가 아니라 보강** — 실패해도 골격 폴백으로 계약 생성이 막히지 않아야 한다.
- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. "데이터 흐름 > AI 초안"(`구조화 입력 → app/api(Claude) → zod 검증 → 성공: draft 저장 / 실패·타임아웃: 골격 draft 저장 + 재시도(기존 draft 갱신, 멱등)`), 시크릿·외부 API(Claude)는 `app/api` 라우트 핸들러/서버 전용 모듈에서만.
- `/docs/ADR.md` — ADR-004(AI 보강 원칙·골격 폴백), ADR-005(서명/문서 관련)
- `/docs/UI_GUIDE.md` — **스텝 인디케이터(점진적 노출)**, **AI 면책 배너**, 폼 규격
- `/docs/UX_PRINCIPLES.md` — 점진적 노출·피드백
- `/CLAUDE.md` — CRITICAL: 시크릿·외부 API는 `app/api`/서버 전용 모듈에서만(클라이언트 직접 호출 금지). Server Action은 zod allowlist·`user_id`는 `getUser()`·서버 소유 필드 client 입력 금지. **FK 참조(contract→client)는 Server Action에서 소유권 재조회 검증 후 insert**(FK는 RLS 우회).
- 이전 phase 산출물(실제 경로):
  - `src/services/ai/contract-draft.ts` — **이미 구현된 AI 서비스(재사용)**. `generateContractDraft(input: ContractDraftInput): Promise<ContractDraft>`(내부에 재시도·골격 폴백 내장), `ContractDraft { title, body, plain_summary, needs_review, source: "ai"|"skeleton" }`, `ContractDraftInput { freelancerName, clientName, scope, amount, startDate?, endDate?, dueDate? }`, `REQUIRED_CONTRACT_CLAUSES`. **이 서비스는 서버 전용** — 클라이언트에서 import 금지.
  - **phase 4 쓰기 패턴 레퍼런스**: `src/app/(dashboard)/clients/actions.ts`(requireUser → zod → user_id 주입 → insert → revalidatePath, `ClientActionResult` 에러 계약), `src/lib/validation/client.ts`(zod allowlist), `src/components/client-form.tsx`(rhf+zod 폼)
  - `src/lib/auth.ts` — `requireUser()`, `src/lib/db/index.ts` — `assertOwned(supabase, "clients", id)`(FK 소유권 재검증), `src/lib/supabase/server.ts` — `createClient()`
  - `src/types/database.ts` — `contracts` Insert 타입(`client_id` FK·`clauses` jsonb·`status` 기본 draft)
  - `src/app/(dashboard)/contracts/[id]/page.tsx` — step 0 상세(생성 후 이동 목적지)

**배경**: 이 step은 **구조화 입력 → AI 초안 → draft 계약 저장**까지다. AI 서비스는 phase 2에서 완성됐으니 **호출·배선**이 핵심이다. 조항 편집·확정은 step 2, 상태전이는 step 3 소관. 여기서는 `status=draft`로만 저장한다.

## 작업

이 step은 **AI 라우트(`app/api`)와 쓰기 경로**를 다루므로 **TDD 대상**이다(테스트 먼저 — Claude/DB 목).

### 1) 입력 zod allowlist — `src/lib/validation/contract.ts`

- 계약 생성 **구조화 입력**의 client 입력 allowlist: `client_id`(uuid), `scope`, `amount`(positive int), `start_date`, `end_date`, `due_date?`. **`user_id`·`status`·`clauses`·`doc_hash`·`signature_meta`·`contract_pdf_url`·`is_demo`는 스키마에 넣지 마라**(서버 소유/파생).
- `lib/`이므로 **테스트 먼저**(`src/lib/validation/__tests__/contract.test.ts`): 유효 통과 / 금액 0·음수 거부 / `end_date < start_date` 거부(가능하면) / 서버 소유 필드 무시.

### 2) AI 초안 라우트 — `src/app/api/contracts/draft/route.ts`

- **Claude 호출은 `app/api`에서만**(CRITICAL). 라우트에서 `requireUser()` 인가 → 입력 zod 검증 → `generateContractDraft(...)` 호출 → 결과(`ContractDraft`)를 반환. Claude 실패·타임아웃 시 서비스가 **골격 폴백**을 반환하므로 라우트는 그 결과를 그대로 신뢰한다(AI는 게이트 아님).
- **입력 매핑**: 폼의 `clientName`/`freelancerName`은 서버에서 조회로 채운다(클라이언트 이름 = `client_id`로 조회, 프리랜서 이름 = 프로필). client가 보낸 이름 문자열을 신뢰하지 마라(소유권·정합성).
- 반환은 초안 텍스트/조항 구조 — **아직 DB 저장 전 미리보기 용도**로 쓸 수도, 저장까지 한 번에 할 수도 있다(아래 3과 통합 가능). 구현 형태는 재량이나 **Claude 시크릿은 이 서버 경로 밖으로 새지 않게** 한다.

### 3) draft 저장 Server Action — `src/app/(dashboard)/contracts/actions.ts`

- `"use server"`. `createContractDraft(input)`: `requireUser()` → 입력 zod 검증 → **`assertOwned(supabase, "clients", input.client_id)`로 FK 소유권 재검증**(타인 client에 계약 생성 차단) → `ContractDraft`를 `clauses` jsonb로 구성해 insert(`user_id`는 서버, `status='draft'`) → `revalidatePath("/contracts")` → 생성 id 반환.
- **`clauses` jsonb 구조**: `{ title, body, plain_summary, needs_review, source }` 및 필요한 조항 배열을 담되, **step 2의 편집·확정이 다룰 구조와 일관**되게. `REQUIRED_CONTRACT_CLAUSES` 골격을 유지(AI가 조항을 삭제/재배치하지 않도록은 서비스가 이미 방어).
- **멱등 재시도**: 같은 입력으로 재생성 시 **기존 draft를 갱신**(중복 계약 양산 금지). 구현은 재량(예: draft id를 받아 update)이나 draft 남발을 막아라.
- 에러 계약은 phase 4의 `ClientActionResult` 형태(`{ ok:true, id } | { ok:false, error, fieldErrors? }`)를 따른다.

### 4) 생성 폼·라우트 — `/contracts/new`

- `src/app/(dashboard)/contracts/new/page.tsx` + client component 폼(`src/components/contract-form.tsx`, `client-form.tsx` 패턴). **스텝 인디케이터(점진적 노출)**: 구조화 입력 → 초안 생성/미리보기 → 저장. **AI 면책 배너**를 초안 화면에 노출.
- 폼 submit → draft 저장 Server Action 호출 → 성공 시 `/contracts/[id]`로 이동(편집·확정은 step 2에서 연결).

### 5) 테스트 (테스트 먼저)

- zod 스키마 테스트(위 1).
- 라우트/액션: Claude 클라이언트·`requireUser`·supabase 목. **AI 실패 시 골격 폴백으로도 draft가 저장**되는지(게이트 아님), **타인 `client_id`면 소유권 검증으로 거부**되는지, `user_id`가 서버에서 채워지는지, `status='draft'` 고정인지.

## Acceptance Criteria

```bash
npm run lint
npm run build     # AI 라우트·액션·폼이 컴파일
npm test          # 스키마·라우트·액션 테스트(테스트 먼저) + 기존 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - **Claude 호출이 `app/api`(서버)에서만** 일어나는가(클라이언트 컴포넌트 직접 호출 없음)?
   - AI 실패·타임아웃 시 **골격 폴백으로 계약 생성이 막히지 않는가**(AI는 보강)?
   - **FK(contract→client) 소유권을 `assertOwned`로 재검증** 후 insert하는가?
   - `user_id`는 서버(getUser), `status='draft'` 고정, 서버 소유 필드를 client 입력으로 받지 않는가?
   - 재생성이 **기존 draft를 갱신**(멱등)해 중복을 안 만드는가?
   - **AI 면책 배너**가 노출되는가?
   - 보안·경계 테스트가 먼저 작성됐는가(TDD)?
3. `phases/5-contracts/index.json`의 step 1을 업데이트(성공/실패/blocked). **Claude API 키가 없어 라우트 실행이 불가하면**, 서비스는 골격 폴백을 반환하므로 **목 기반 테스트로 검증**하고 완료 처리하라(실 키는 배포 시). 실 키가 반드시 필요한 상황이면 `blocked`+사유.

## 금지사항

- Claude 시크릿/호출을 서버 라우트·서버 전용 모듈 밖(클라이언트 컴포넌트·Server Action에서 직접 SDK)에서 하지 마라. 이유: CRITICAL — 시크릿·외부 API는 `app/api`/서버 전용에서만.
- AI를 **필수 게이트로 만들지 마라**(AI 실패 시 생성 차단 금지). 이유: ADR-004 — AI는 보강, 실패 시 골격 폴백.
- `client_id`를 소유권 검증 없이 insert하지 마라. 이유: CRITICAL — FK는 RLS 우회. 타인 client에 계약이 붙는다.
- `user_id`·`status`·`clauses` 서버구성값 등을 client 입력으로 받지 마라. 이유: 소유/상태 위조.
- 조항 편집·확정(step 2)·상태전이(step 3)·서명(step 4)·PDF(step 5)를 여기서 하지 마라. 이유: 각 step 소관. 여기는 draft 생성까지.
- 같은 입력으로 draft를 무한 양산하지 마라(멱등 갱신). 이유: 중복 계약 오염.
- 테스트 없이 라우트/액션/스키마 로직을 작성하지 마라(TDD 가드).

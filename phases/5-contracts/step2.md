# Step 2: contract-edit-confirm

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — 상태 전이 머신(계약 `draft` 동안만 조항 편집 가능, 서명 후 read-only), 쓰기 흐름(Server Action + zod allowlist 재검증).
- `/docs/PRD.md` — 기능2(초안 검토·편집·확정)
- `/docs/UI_GUIDE.md` — 조항/평문요약 카드·폼·`needs_review` 강조(검토 필요 표시)
- `/CLAUDE.md` — CRITICAL: 쓰기는 Server Action, zod allowlist, `user_id`는 getUser. AI 결과는 항상 "초안"으로 취급·면책 노출.
- 이전 step 산출물(실제 경로):
  - `src/app/(dashboard)/contracts/actions.ts` — step 1 계약 액션(여기에 편집·확정 액션 추가)
  - `src/lib/validation/contract.ts` — step 1 zod 스키마(여기에 `clauses` 검증 확장)
  - `src/services/ai/contract-draft.ts` — `ContractDraft`·`REQUIRED_CONTRACT_CLAUSES`(조항 구조·필수 조항 집합의 출처)
  - `src/components/contract-form.tsx`, `src/app/(dashboard)/contracts/[id]/page.tsx` — step 0·1 UI(편집 UI 연결 지점)
  - `src/lib/db/index.ts` — `assertOwned`, `src/lib/supabase/server.ts` — `createClient()`
  - `src/types/database.ts` — `contracts` Update 타입(`clauses` jsonb·`status`)

**배경**: step 1이 만든 draft 계약의 **조항을 편집하고 확정**한다. **확정 = status 전이(draft→signed 등)가 아니다** — 상태전이는 step 3, 서명은 step 4 소관. 여기서 "확정"은 **조항 내용을 사용자가 검토·수정해 draft를 완성 상태로 다듬는 것**(여전히 `status='draft'`). status 변경 자체는 step 3에서 버튼으로.

## 작업

이 step은 `clauses` jsonb 검증·쓰기 경로이므로 **TDD 대상**(테스트 먼저).

### 1) `clauses` zod 검증 — `src/lib/validation/contract.ts` 확장

- `clauses` jsonb의 구조를 zod로 정의: 조항 배열/객체 형태(step 1 저장 구조와 일치), `title`·`body`·`plain_summary`·`needs_review`(boolean) 포함. **`REQUIRED_CONTRACT_CLAUSES`의 필수 조항이 누락되지 않았는지** 검증(AI/사용자가 골격을 훼손하지 않도록).
- **테스트 먼저**(`contract.test.ts`에 추가): 유효 clauses 통과 / 필수 조항 누락 거부 / `needs_review` 타입 검증 / 빈 body 거부.

### 2) 편집·확정 Server Action — `src/app/(dashboard)/contracts/actions.ts`

- `updateContractClauses(id, input)`: `requireUser()` → **대상 계약이 본인 소유이고 `status='draft'`인지 확인**(서명/확정 이후엔 조항 편집 불가 — read-only) → `clauses` zod 검증 → `contracts.clauses` UPDATE → `revalidatePath("/contracts", "/contracts/[id]")`.
- **서명 이후 편집 차단**: 대상 status가 `draft`가 아니면 편집을 거부(에러 반환). 조항을 고치려면 step 3의 "draft로 되돌리기"가 선행돼야 한다(문서 해시 무결성).
- 에러 계약은 phase 4 `ClientActionResult` 형태.

### 3) 편집 UI — 조항 편집 화면

- `src/app/(dashboard)/contracts/[id]/edit/page.tsx`(또는 상세 내 편집 모드) + client 폼. `needs_review=true`인 조항·`[검토 필요]` 마킹을 **시각적으로 강조**(사용자가 검토하도록). **AI 면책 배너** 유지.
- 저장 → 편집 액션 호출 → 성공 피드백. **외과적 변경**: step 0·1의 상세·폼 마크업을 크게 갈아엎지 말고 편집 배선만 추가.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test          # clauses 검증·편집 액션 테스트(테스트 먼저) + 기존 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `clauses` zod 검증이 **필수 조항 누락을 거부**하는가?
   - 편집 액션이 **`status='draft'`일 때만** 조항을 수정하고, 서명 이후엔 거부하는가?
   - `user_id`·소유권을 서버에서 확인하는가?
   - `needs_review`/`[검토 필요]`가 UI에서 강조되고 면책 배너가 유지되는가?
   - 보안·검증 테스트가 먼저인가(TDD)?
3. `phases/5-contracts/index.json`의 step 2를 업데이트(성공/실패/blocked).

## 금지사항

- status를 여기서 전이시키지 마라(draft→signed 등). 이유: 상태전이는 step 3 소관. 여기 "확정"은 조항 내용 완성이지 상태 변경이 아니다.
- `draft`가 아닌 계약의 조항을 편집 가능하게 하지 마라. 이유: 서명 후 조항 read-only(문서 해시 무결성) — 편집하려면 step 3에서 draft로 되돌려야 한다.
- 서명·`doc_hash`·`signature_meta`를 다루지 마라. 이유: step 4 소관.
- `contract_events`에 INSERT 하지 마라. 이유: 이벤트는 상태전이(step 3)에서만. 조항 편집은 status 전이가 아니다.
- 기존 테스트·step 0·1 마크업을 불필요하게 건드리지 마라(외과적 변경).

# Step 3: contract-status

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. "상태 전이 머신 > contract.status"(`draft → signed → active → done`, 각 전이 명시적 버튼, `active/done` 수동, `canceled`는 `done` 외 어디서든. 서명 후 조항 read-only — 편집하려면 draft로 되돌려 `signature_meta` 초기화·재서명). "데이터 흐름"(도메인 UPDATE → 이벤트 로그 INSERT **순차, best-effort**). "상태 전이 머신 > 모든 전이는 이벤트 로그에 append → 상세 이력 타임라인".
- `/docs/ADR.md` — ADR-005(문서 무결성·상태), 상태 로그 설계
- `/CLAUDE.md` — CRITICAL: 상태 전이는 **append-only 이벤트 로그에 함께 기록**(도메인 UPDATE 후 이벤트 INSERT, 순차). **status 변경을 쓰기 순서 앞쪽에 두지 말 것**(부분 실패 시 미완 방지). 이벤트 테이블은 select/insert만(append-only).
- 이전 step 산출물(실제 경로):
  - `src/app/(dashboard)/contracts/actions.ts` — 계약 액션(여기에 상태전이 액션 추가)
  - `src/app/(dashboard)/contracts/[id]/page.tsx` — 상세(상태전이 버튼·이력 타임라인 연결 지점, step 0에서 자리만 둠)
  - `src/lib/db/index.ts` — `assertOwned`, `src/lib/supabase/server.ts` — `createClient()`, `src/lib/auth.ts` — `requireUser()`
  - `src/types/database.ts` — `contract_status` enum(`draft|signed|active|done|canceled`), `contract_events` Insert 타입(`from_status?`·`to_status`·`event_type`·`actor`·`meta`)
  - `src/components/contract-status-badge.tsx` — step 0 상태 배지

**배경**: 계약 **상태 머신과 이벤트 로그**를 붙인다. 이 step이 정립하는 **"도메인 UPDATE → 이벤트 INSERT 순차" 패턴**을 phase 6 인보이스 정산이 그대로 따른다. 서명(step 4)은 이 전이 규칙 위에서 `signed`로 가는 특수 케이스다. **`signed`로의 전이 자체는 step 4(서명)가 수행**하므로, 이 step은 `draft↔`(되돌리기)·`signed→active→done`·`canceled` 전이와 **전이 규칙·이벤트 로깅 공통 로직**을 만든다.

## 작업

상태 전이는 **데이터 무결성 경계**다 → **TDD 필수**(테스트 먼저).

### 1) 전이 규칙 순수 함수 — `src/lib/contract-status.ts`

- 허용 전이만 통과시키는 순수 함수(예: `canTransition(from, to): boolean` 또는 전이 맵). 규칙:
  - `draft → signed`(서명, step 4), `signed → active`, `active → done`.
  - `canceled`는 `done`을 제외한 어디서든 가능.
  - **`draft로 되돌리기**: `signed`(또는 그 이후 done 전) → `draft` 되돌림 시 **조항 재편집 허용을 위해 `signature_meta`·`doc_hash`·`signature_image_path` 초기화**가 동반돼야 함(무결성). 이 초기화 필요 여부도 규칙으로 표현.
  - `done`은 종착(되돌리기 규칙은 스펙 재량 — 임의 역전 금지).
- `lib/`이므로 **테스트 먼저**(`src/lib/__tests__/contract-status.test.ts`): 허용 전이 통과 / 비허용 전이(예: `done→draft`, `draft→done`) 거부 / `canceled` 규칙 / 되돌리기 시 초기화 플래그.

### 2) 상태전이 Server Action — `src/app/(dashboard)/contracts/actions.ts`

- `transitionContractStatus(id, toStatus)`(또는 전이별 명시 액션): `requireUser()` → 대상 계약 소유·현재 status 조회 → **`canTransition(current, to)` 검증**(위반 시 거부) → **쓰기 순서(CRITICAL)**:
  1. **도메인 UPDATE**(`contracts.status = to`, 되돌리기면 `signature_meta`/`doc_hash`/`signature_image_path` 초기화 동반)
  2. **그 다음** `contract_events` INSERT(`from_status`·`to_status`·`event_type`·`actor=user.id`·`meta`, `user_id` 서버)
  3. `revalidatePath("/contracts", "/contracts/[id]")`
  - **status 변경을 이벤트보다 앞에 두되(도메인이 진실), 이벤트 INSERT 실패가 status 롤백을 강제하진 않는다(best-effort append)** — 단 **순서를 지켜라**(status UPDATE 성공 후 이벤트). 서명(step 4)처럼 업로드/해시가 선행하는 케이스와 구분: 여기선 선행 부작용이 없으므로 status UPDATE가 첫 쓰기.
  - **`draft`로 되돌리면 조항이 다시 편집 가능**(step 2와 정합) — 서명 산출물 초기화로 무결성 유지.
- 에러 계약은 phase 4 `ClientActionResult` 형태.

### 3) 상세 UI 배선

- `src/app/(dashboard)/contracts/[id]/page.tsx`에 **명시적 전이 버튼**(현재 status에서 가능한 전이만 노출) + **이력 타임라인**(step 0에서 자리만 둔 부분에 `contract_events` 렌더). 각 버튼 → 전이 액션. **외과적 변경**: 상세 마크업 최소 수정.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test          # 전이 규칙·상태전이 액션 테스트(테스트 먼저) + 기존 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 전이 규칙이 **비허용 전이를 거부**하는가(`done→draft` 등)?
   - 액션이 **도메인 UPDATE → 이벤트 INSERT 순서**로 쓰는가(status를 이벤트보다 뒤에 두지 않되, 선행 부작용 없는 이 케이스에서 status가 첫 쓰기)?
   - `draft`로 되돌릴 때 `signature_meta`/`doc_hash`/`signature_image_path`를 **초기화**하는가(무결성)?
   - 이벤트가 append-only로 쌓이고 이력 타임라인에 노출되는가?
   - 소유권·`user_id`를 서버에서 확인하는가?
   - 무결성 테스트가 먼저인가(TDD)?
3. `phases/5-contracts/index.json`의 step 3을 업데이트(성공/실패/blocked).

## 금지사항

- 비허용 상태 전이를 통과시키지 마라. 이유: 상태 머신 무결성(예: 서명 안 된 계약을 done으로).
- 이벤트 INSERT를 status UPDATE보다 앞에 두거나, status 변경을 쓰기 순서 맨 앞(선행 부작용 케이스)에서 성급히 하지 마라. 이유: CRITICAL — 부분 실패 시 미완 상태 방지.
- `draft`로 되돌리면서 서명 산출물(`signature_meta`/`doc_hash`/이미지 경로)을 남겨두지 마라. 이유: 조항이 다시 편집 가능해지므로 옛 서명·해시가 무효(문서 위조 소지).
- `contract_events`를 UPDATE/DELETE 하지 마라. 이유: append-only(정책상 insert/select만).
- **실제 서명(캔버스·이미지 업로드·`signed` 전이의 부작용)을 여기서 구현하지 마라.** 이유: step 4 소관. 여기선 전이 규칙·이벤트 공통 로직 + 비서명 전이.
- 기존 테스트를 깨뜨리지 마라.

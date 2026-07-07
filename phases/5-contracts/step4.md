# Step 4: signature

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. "데이터 흐름 > 서명(부분 실패 최소화 순서)":
  ```
  캔버스 PNG → Server Action/route → Storage 업로드(private, {user_id}/{contract_id}/)
            → doc_hash 산출 + IP/UA 메타(서버) → 도메인 UPDATE(status=signed) → 이벤트 INSERT
    ※ status 변경을 앞쪽에 두지 않아 업로드/해시 실패 시 미완 상태로 남지 않게 한다.
  ```
  Storage 규칙(private 버킷 + `{user_id}/...` 경로, DB엔 key만·읽기는 단기 signed URL), `signature_meta` = `{signer, signed_at, ip, ua}`(IP/UA는 서버 라우트에서만).
- `/docs/ADR.md` — ADR-005(서명·문서 해시·`legalEffect: none` v1, 법적효력 v2)
- `/docs/UI_GUIDE.md` — 캔버스 서명 UI·면책(v1 서명은 법적효력 없음 고지)
- `/CLAUDE.md` — CRITICAL: 전자서명은 `services/`의 **v1 Provider 인터페이스 뒤로만**. 서버 소유 필드(`doc_hash`·`signature_meta`·pdf 경로·status)는 client 입력 금지. Storage는 private + `{user_id}/...`, DB엔 key만·단기 signed URL. 상태 전이는 이벤트 append.
- 이전 step 산출물(실제 경로):
  - `src/services/signature/provider.ts` — **이미 구현된 서명 Provider(재사용)**. `createV1SignatureProvider()`, `computeDocHash(clauses): string`(canonical clauses JSON SHA-256), `createSignatureResult({ clauses, signatureImagePath }): V1SignatureResult`(`{ provider:"v1", docHash, signatureImagePath, legalEffect:"none" }`). **서버 전용**.
  - `src/lib/contract-status.ts` — step 3 전이 규칙(`draft → signed` 허용 검증에 사용)
  - `src/app/(dashboard)/contracts/actions.ts` — 계약 액션(전이·이벤트 로깅 패턴)
  - `src/lib/supabase/server.ts` — `createClient()`(Storage·DB), `src/lib/auth.ts` — `requireUser()`, `src/lib/db/index.ts` — `assertOwned`
  - `src/types/database.ts` — `contracts`(`signature_image_path`·`doc_hash`·`signature_meta`·`status`), `contract_events` Insert
  - `src/app/(dashboard)/contracts/[id]/page.tsx` — 상세(서명 진입점·서명 후 표시)

**배경**: 계약을 **캔버스로 서명 → `signed` 전이**한다. 이 step은 **Storage 인프라가 처음 도입**되는 곳이자(private 버킷·`{user_id}/{contract_id}/` 경로), **IP/UA를 서버에서 기록**하는 유일한 경로다. 서명 후 조항은 read-only(step 2·3과 정합). **PDF 생성은 step 5** 소관.

## 작업

서명은 **보안·무결성 경계**(문서 해시·서버 메타·쓰기 순서) → **TDD 필수**(테스트 먼저 — Storage·DB·headers 목).

### 1) 서명 처리 경로 — 라우트 핸들러 권장: `src/app/api/contracts/[id]/sign/route.ts`

- **IP/UA를 서버에서 기록**해야 하므로 요청 헤더 접근이 자연스러운 **route handler**를 권장(`headers()`/request에서 IP·User-Agent). 캔버스 PNG(base64/blob)를 body로 받는다. `requireUser()` 인가.
- **쓰기 순서(CRITICAL — 그대로 지켜라)**:
  1. 대상 계약 소유·현재 status 확인 + **`canTransition(current, "signed")` 검증**(draft에서만 서명).
  2. **Storage 업로드**: private 버킷 `{user_id}/{contract_id}/signature.png`. DB엔 **key만** 저장(URL 아님).
  3. **`doc_hash` 산출 + `signature_meta` 구성(서버)**: `createV1SignatureProvider().computeDocHash(clauses)` 및 `signature_meta = { signer, signed_at(서버 시각), ip, ua }`. **IP/UA는 서버 request에서만** — client 입력 금지.
  4. **도메인 UPDATE**: `contracts` `status='signed'`·`signature_image_path=key`·`doc_hash`·`signature_meta` 한 번에.
  5. **`contract_events` INSERT**(`from_status='draft'`·`to_status='signed'`·`event_type='signed'`·`actor=user.id`·`meta`, `user_id` 서버).
  6. `revalidatePath`.
  - ※ **status 변경을 2·3(업로드·해시)보다 앞에 두지 마라** — 업로드/해시 실패 시 `signed`인데 서명물 없는 미완 상태가 된다.
- **서명은 `services/signature` Provider 뒤로만**(직접 crypto 호출로 재구현 금지 — v2 교체 지점).

### 2) 읽기: signed URL

- 서명 이미지·(step 5의 PDF) 표시는 DB의 key로 **단기 signed URL**을 발급해 읽는다(공개 URL 저장 금지). 상세에서 서명 이미지를 signed URL로 표시.

### 3) 캔버스 서명 UI — client component

- `src/components/signature-pad.tsx`(캔버스). 서명 → PNG로 위 라우트에 전송. **v1 서명 면책**(법적효력 없음, `legalEffect: none`) 고지. 서명 후 상세는 서명 완료·조항 read-only 표시.

### 4) 테스트 (테스트 먼저)

- Storage·supabase·`headers()` 목. **쓰기 순서 검증**: 업로드·해시가 status UPDATE보다 먼저 일어나는지. **IP/UA가 서버 request에서** 오고 client 입력을 신뢰하지 않는지. `doc_hash`가 Provider로 산출되는지. `draft`가 아닌 계약은 서명 거부. 서버 소유 필드(`doc_hash`·`signature_meta`·status)를 client가 밀어넣어도 무시되는지.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test          # 서명 순서·메타·해시 테스트(테스트 먼저) + 기존 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - **쓰기 순서**가 업로드 → 해시/메타 → status=signed → 이벤트 순인가(status를 앞에 두지 않음)?
   - **IP/UA가 서버 request에서만** 기록되는가(client 입력 금지)?
   - `doc_hash`가 **`services/signature` Provider**로 산출되는가(직접 crypto 재구현 금지)?
   - Storage가 **private + `{user_id}/{contract_id}/`**, DB엔 key만, 읽기는 **단기 signed URL**인가?
   - `draft`에서만 서명 가능한가(전이 규칙)?
   - 서버 소유 필드를 client 입력으로 받지 않는가?
   - 보안·순서 테스트가 먼저인가(TDD)?
3. `phases/5-contracts/index.json`의 step 4를 업데이트(성공/실패/blocked). **Storage 버킷이 원격 Supabase에만 있어 로컬 검증이 불가하면** 목 기반 테스트로 순서·경계를 검증하고, 버킷 프로비저닝이 수동 개입을 요하면 `blocked`+사유.

## 금지사항

- status=signed를 업로드·해시보다 먼저 쓰지 마라. 이유: CRITICAL — 부분 실패 시 서명물 없는 signed 미완 상태.
- IP/UA·`signature_meta`·`doc_hash`·`status`를 client 입력에서 받지 마라. 이유: CRITICAL — 서버 소유 필드 위조.
- `doc_hash`를 Provider 밖에서 직접 재구현하지 마라. 이유: 전자서명은 v1 Provider 인터페이스 뒤로만(v2 교체 지점).
- Storage 공개 URL을 DB에 저장하거나 공개 버킷을 쓰지 마라. 이유: private + key만 저장·단기 signed URL 규칙.
- 서명 후 조항을 편집 가능하게 두지 마라. 이유: 서명 후 read-only(무결성). 편집은 step 3의 draft 되돌리기 경유.
- **PDF를 생성하지 마라.** 이유: step 5 소관.
- 기존 테스트를 깨뜨리지 마라.

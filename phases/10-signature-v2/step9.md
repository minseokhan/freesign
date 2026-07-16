# Step 9: guards-docs

마무리: 앱 레이어 가드 UX, `sent`·legalEffect 표기, 문서 갱신. 신규 기능 표면은 없다 — 기존 화면·액션에 v2를 정합시키는 step.

## 읽어야 할 파일

- `/docs/SIGNATURE_V2_PLAN.md` — §2(증거 보존·legalEffect 행), §3 Step 8, §4 리스크 전체(문서에 반영할 한계)
- `/docs/LEGAL_SIGNATURE.md` — §A-2/3/4/5(구현 반영 표시할 부분), §B(해시 노출)
- `/docs/ADR.md` — 기존 ADR 형식(ADR-009 추가)
- `/docs/DATABASE.md` — 갱신 대상
- `src/app/(dashboard)/contracts/actions.ts`(및 signature-actions 분리 파일) — `deleteContract`·`transitionContractStatus` 현재 구현
- `src/lib/contract-status.ts` — step 0의 `ctx.hasCounterpartySignature` 시그니처
- 계약 목록·상세 컴포넌트(`src/app/(dashboard)/contracts/` 하위) — status 배지·legalEffect 문구 위치
- 이전 step 전체 산출물 개요: `phases/10-signature-v2/index.json`의 summary들

## 작업

### 1) `deleteContract` 가드 UX

- 삭제 전 counterparty 서명 존재를 조회(RLS 스코프)하고, 존재하면 삭제를 진행하지 말고 사용자 메시지 반환: **"맞서명이 완료된 계약은 삭제할 수 없습니다. 대신 '취소'로 무효화하세요."**
- DB 트리거(step 1)는 최후 방어선으로 그대로 두고, 이 앱 체크는 UX용 사전 안내다. 삭제 확인 다이얼로그 문구에도 반영.

### 2) `transitionContractStatus` ctx 연결

- 전이 전에 해당 계약의 counterparty 서명 존재를 조회 → `getContractStatusTransition(from, to, { hasCounterpartySignature })`에 전달. 차단 시 사용자 메시지(무효화 유도).
- 상태 변경 UI 셀렉트가 `sent` 진입을 노출하지 않는지 확인(step 0의 가용 전이 목록 함수 사용).

### 3) 표기

- 계약 목록·상세에 `sent` 상태 배지(기존 배지 컴포넌트 패턴, 라벨 예: "서명 대기") 추가. 목록 필터가 status 기반이면 sent 포함 확인.
- legalEffect 문구: 단독 서명 계약 → **"기록용 서명"**, 맞서명 완결 계약 → **"양 당사자 동의 서명 · 이메일 소유확인 수준"**. 계약 상세의 서명 정보 영역에 doc_hash 축약 노출(LEGAL §B — 전문은 복사 가능하게 title/tooltip 등).
- 맞서명 완결 계약 상세에 완결증명서 다운로드 링크(`/api/contracts/[id]/certificate`, step 7) 노출.

### 4) 문서

- `/docs/ADR.md`에 **ADR-009** 추가: (a) `sent` 상태 도입 (b) anon 접근은 SECURITY DEFINER RPC 경계 (c) 상대 서명 이미지 DB base64 저장 — "DB엔 key만" 규칙의 명시적 예외와 근거 (d) counterparty 서명 존재 시 삭제 차단 (e) TimestampProvider(RFC 3161) 어댑터. 기존 ADR 형식(맥락·결정·결과) 준수.
- `/docs/LEGAL_SIGNATURE.md` §A-2/3/4/5에 구현 완료 표시와 실제 파일 경로 주석.
- `/docs/DATABASE.md`에 신규 테이블 2종·RPC·트리거·anon 레이트리밋 반영.
- `/docs/SIGNATURE_V2_PLAN.md` 상단에 구현 완료(phase 10) 표기 한 줄.

## TDD (테스트 먼저 작성)

1. `deleteContract`: counterparty 서명 존재 mock 시 삭제 미실행 + 안내 메시지 반환
2. `transitionContractStatus`: counterparty 서명 존재 + to=draft 시 차단 메시지 (기존 액션 테스트 패턴)

## Acceptance Criteria

```bash
npm run lint
npm test
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 트리거·RPC 가드(DB)와 앱 가드의 규칙이 일치하는가?
   - legalEffect 문구가 과대표시 없이(소유확인 수준 명시) 표기되는가?
   - ADR-009가 5개 결정을 모두 담는가?
3. 결과에 따라 `phases/10-signature-v2/index.json`의 step 9를 업데이트한다 (성공: completed+summary / 3회 실패: error+error_message / 개입 필요: blocked+blocked_reason 후 중단).

## 금지사항

- 새 기능(알림·리마인더·서명 순서 옵션 등)을 추가하지 마라. 이유: 이 step은 정합·표기·문서만 — 요청받지 않은 기능 금지.
- 트리거를 믿고 앱 체크를 생략하거나, 앱 체크를 믿고 트리거를 제거하지 마라. 이유: 이중 가드가 확정 설계(앱=UX, DB=최후 방어선).
- "법적 효력 있음/없음" 이분법 문구로 되돌리지 마라. 이유: 입증력 단계 표현(record/mutual)이 확정 결정.
- 문서 갱신 시 관련 없는 섹션을 재작성하지 마라. 이유: 외과적 변경.
- 기존 테스트를 깨뜨리지 마라.

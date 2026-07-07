# Step 3: signature-provider

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-003**(Provider 어댑터로 서명·결제 우회, v1 → v2 교체 지점). 전자서명은 `services/signature`의 `SignatureProvider` 인터페이스 뒤에 둔다. v1은 간이 서명(캔버스+해시). 어댑터는 "교체 지점 표시"이지 완전한 추상화는 아님. v1은 법적효력 없음(면책)
- `/docs/ARCHITECTURE.md` — 데이터 모델 `contracts.doc_hash`(**1급 컬럼 · canonical clauses JSON SHA-256 · 예시적 무결성(법적효력 v2)**), `signature_image_path`/`contract_pdf_url`(private Storage key), "데이터 흐름"의 **서명 순서**(캔버스 PNG → Storage 업로드 → `doc_hash` 산출 + IP/UA 메타(서버) → status=signed → 이벤트 INSERT. status를 앞쪽에 두지 않음)
- `/docs/PRD.md` — 방어 코어는 "계약 → 지급기한 → 입금/미수 증빙"의 **기록 체인**. `doc_hash`는 그 무결성 증빙의 핵심
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: 전자서명은 `services/`의 **v1 전용 Provider 인터페이스** 뒤로만 접근. `doc_hash` = canonical clauses JSON SHA-256
- phase 1 산출물: `src/types/database.ts` — `contracts.doc_hash`(text) 컬럼 shape(이 함수 결과가 그 컬럼에 저장됨)

**배경**: 이 step은 서명의 **v2 교체 지점**인 `SignatureProvider` 인터페이스와, v1의 핵심 로직인 **`doc_hash` 계산(canonical clauses JSON SHA-256)** 만 만든다. 캔버스 UI·Storage 업로드·IP/UA 메타 기록·status 전이·이벤트 로그는 **phase 5(signature step)** 소관이며 여기서 만들지 않는다. `doc_hash`는 "같은 조항이면 항상 같은 해시"라는 **결정성**이 생명이므로, 이 계산을 순수 함수로 못박아 두는 게 이 step의 목적이다.

## 작업

`src/services/signature/`에 `SignatureProvider` 인터페이스와 v1 어댑터를 만든다.

`.codex` TDD 가드가 `services/*.ts`를 테스트 없이 차단한다. **테스트를 먼저 작성**하라(`src/services/signature/__tests__/*.test.ts`). 순수 인터페이스(타입)만 담는 파일이 필요하면 `src/types/`에 둘 수 있으나(가드 예외), `doc_hash` 계산 로직은 반드시 테스트 동반.

### 핵심 규칙 (반드시 지켜라)

- **`doc_hash` = canonical clauses JSON의 SHA-256**. "canonical"이 핵심: **키 정렬·공백 정규화**로 동일 조항이 표현·직렬화 순서와 무관하게 항상 같은 바이트열을 낳아야 한다. 그렇지 않으면 무결성 증빙이 무의미해진다(같은 계약이 다른 해시).
  - 객체 키를 **정렬**하고(재귀적으로), 유효 whitespace를 제거한 결정적 직렬화를 쓴 뒤 SHA-256. Node `crypto`(`createHash('sha256')`) 사용 — 서버 전용.
- **v1은 무결성 "예시"일 뿐 법적효력 없음**(ADR-003). 실 서명 API를 흉내내지 마라. v1 Provider는 (a) 조항으로 `doc_hash` 산출, (b) 서명 이미지(캔버스 PNG) 참조를 다루는 최소 인터페이스까지.
- **이 step은 Storage 업로드·IP/UA·status 전이·이벤트를 하지 마라**(phase 5). Provider 인터페이스는 그것들의 **자리(메서드 시그니처)** 만 정의하고, v1 구현은 `doc_hash` 계산 등 부수효과 없는 부분만 실제 구현한다.

### 시그니처(예시 — 정확한 형태는 재량)

```ts
// 조항의 정규 표현(phase 5가 이 shape로 넘긴다) — 확정 형태는 phase 5에서 굳는다
export type Clause = { heading: string; body: string; /* ... */ };

// v2 교체 지점. v1/v2가 공통으로 만족할 계약.
export interface SignatureProvider {
  // canonical clauses JSON의 SHA-256 hex. 순수·결정적.
  computeDocHash(clauses: Clause[]): string;
  // v1: 캔버스 PNG + doc_hash로 서명 결과를 구성(Storage 업로드·메타 기록은 호출측 phase 5).
  // 시그니처만 정의하고 v1은 최소 구현. IP/UA·업로드를 이 안에서 하지 마라.
}

export function createV1SignatureProvider(): SignatureProvider;
```

`Clause` 타입의 최종 형태는 phase 5(contract 조항 편집)에서 확정되므로, 여기서는 `computeDocHash`가 **키 정렬 canonical 직렬화**를 하는 계약만 못박고 최소 형태로 둔다. 과도하게 조항 스키마를 설계하지 마라(phase 5 소관).

### 테스트 (먼저 작성)

- **결정성**: 같은 조항 배열을 **키 순서만 다르게** 구성 → 동일 `doc_hash`. (canonical 직렬화가 실제로 정규화하는지)
- **민감성**: 조항 내용을 한 글자라도 바꾸면 → 다른 `doc_hash`.
- **형식**: SHA-256 hex(64자) 형태인가.
- **순수성**: 같은 입력 반복 호출 → 항상 같은 값(부수효과·상태 없음).

## Acceptance Criteria

```bash
npm run lint
npm run build
npm test    # signature 서비스 단위테스트(테스트 먼저) + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `doc_hash`가 **canonical(키 정렬) clauses JSON SHA-256**인가? 키 순서만 다른 동일 조항이 같은 해시를 내는가?
   - Node `crypto` 기반 서버 전용인가?
   - Storage 업로드·IP/UA·status 전이·이벤트를 **여기서 하지 않았는가**(phase 5로 남겼는가)?
   - `SignatureProvider`가 v2 교체 지점으로서 인터페이스로 분리됐는가?
   - 테스트가 먼저 작성됐는가(TDD)?
3. `phases/2-domain-logic/index.json`의 step 3을 업데이트(성공 `completed`+summary / 3회 실패 `error` / 개입 필요 `blocked`).

## 금지사항

- 캔버스 서명 UI·Storage 업로드·IP/UA 메타 기록·status 전이·이벤트 로그를 만들지 마라. 이유: phase 5(signature) 소관. 부분 실패 순서(업로드→해시→status→이벤트)도 phase 5가 배선한다.
- `doc_hash`에 **키 정렬 없는** `JSON.stringify`를 쓰지 마라. 이유: 키 순서·공백에 따라 같은 계약이 다른 해시를 내 무결성 증빙이 깨진다.
- v1을 실 전자서명 API처럼 과설계하지 마라. 이유: ADR-003 — v1은 원리 재현(무결성 예시)까지, 법적효력 없음. 실 API는 v2 재설계 대상.
- 조항 스키마(`Clause`)를 상세 설계하지 마라. 이유: 조항 편집·확정은 phase 5 소관. 여기선 해시 계약만 못박고 최소 형태로 둔다.
- 기존 테스트를 깨뜨리지 마라.

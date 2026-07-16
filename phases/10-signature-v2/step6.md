# Step 6: send-ui

owner 발송 플로우의 UI: 서명 캔버스 공용 추출, 상대방 서명 요청 폼, 계약 상세의 탭·sent 카드. **공개(anon) 페이지는 이 step 범위가 아니다(step 8 소관).**

## 읽어야 할 파일

- `/docs/SIGNATURE_V2_PLAN.md` — §3 Step 5의 UI 부분
- `/docs/UI_GUIDE.md`, `/docs/UX_PRINCIPLES.md` — 컴포넌트·문구 관례
- `src/components/signature-pad.tsx` — **추출 원본**: 캔버스 드로잉 로직과 이를 사용하는 기존 단독 서명 UI
- `src/app/(dashboard)/contracts/[id]/` 하위 페이지·컴포넌트 — 계약 상세 구조, 기존 서명 섹션이 어디에 어떻게 붙는지
- 이전 step 산출물: step 5의 Server Actions(`sendSignatureRequest`·`resendSignatureRequestEmail`·`revokeSignatureRequest`) — 액션 시그니처·에러 반환 형태
- `src/components/` 하위 기존 폼 컴포넌트 — react-hook-form + zod + shadcn/ui 스타일

## 작업

### 1) 캔버스 추출 — 신규 `src/components/signature-canvas.tsx`

- `signature-pad.tsx`에서 **순수 캔버스 드로잉 부분만** 추출(그리기·지우기·dataURL 추출). props로 값 변경 콜백을 받는 제어 컴포넌트로.
- `signature-pad.tsx`는 추출된 캔버스를 사용하도록 리팩토링하되 **기존 단독 서명 UX·동작 불변**. 이것이 이 step의 유일한 기존 코드 리팩토링이다.
- step 8의 공개 페이지가 재사용할 수 있도록 대시보드 의존성(auth·계약 데이터)이 캔버스 컴포넌트에 스며들지 않게 하라.

### 2) 신규 `src/components/signature-request-form.tsx`

- 필드: 수신자 이메일(필수)·수신자 이름(선택), SignatureCanvas(owner 서명), 동의 체크 2종(전자서명 약정 동의·개인정보 동의 — 각각 명시적 문구, 기본 해제 상태), 제출 버튼 **"서명하고 요청 보내기"**
- react-hook-form + zod(step 5 액션의 allowlist와 정합), 제출 → `sendSignatureRequest` 호출, pending 상태·에러 표시(기존 폼 관례).
- 동의 문구는 서명 시점 명시적 동의 캡처가 법적 요건임을 반영(전자서명법 3조 2항) — 체크 없이 제출 불가.

### 3) 계약 상세 통합

- **draft 상태**: 기존 단독 서명 영역을 탭 2개로: `단독 서명`(기존 signature-pad 그대로) | `상대방 서명 요청`(신규 폼). 기존 단독 서명 플로우의 동작·문구를 바꾸지 마라.
- **sent 상태**: 요청 현황 카드 — 수신자 이메일·이름, 만료일, 열람 시각(`first_viewed_at`, 미열람이면 "아직 열람 전"), `재발송` 버튼(→ resend 액션), `철회` 버튼(→ revoke 액션, confirm 다이얼로그: 철회 시 draft로 돌아가고 기존 링크가 무효화됨을 안내).
- sent 데이터는 RSC에서 Supabase 직접 조회(RLS 스코프)로 가져와 props로 내려라 — 내부 /api fetch 금지.

## TDD (테스트 먼저 작성)

기존 컴포넌트 테스트 관례가 있으면 미러링, 없으면 액션 연동 로직 위주로:

1. 폼: 동의 미체크 시 제출 불가(액션 미호출), 이메일 형식 오류 표시
2. 정상 제출 시 `sendSignatureRequest`가 올바른 필드로 호출됨(mock)
3. signature-pad 기존 테스트가 있다면 리팩토링 후에도 green

## Acceptance Criteria

```bash
npm run lint
npm test
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `signature-canvas.tsx`에 auth·데이터 조회 의존성이 없는가(공개 페이지 재사용 가능)?
   - 기존 단독 서명 UX가 변하지 않았는가?
   - 읽기가 RSC 직접 조회인가(내부 /api fetch 우회 없음)?
3. 결과에 따라 `phases/10-signature-v2/index.json`의 step 6을 업데이트한다 (성공: completed+summary / 3회 실패: error+error_message / 개입 필요: blocked+blocked_reason 후 중단).

## 금지사항

- 공개 서명 페이지(`/sign/[token]`)를 만들지 마라. 이유: step 8 소관.
- 목록의 sent 배지·legalEffect 문구 등 표기 전반을 손대지 마라. 이유: step 9 소관. 이 step은 계약 상세의 발송 UI만.
- signature-pad 추출 시 기존 스타일·동작을 "개선"하지 마라. 이유: 외과적 변경 — 추출은 이동이지 리디자인이 아니다.
- 서버 소유 필드(status 등)를 클라이언트에서 조작하는 경로를 만들지 마라. 이유: 상태 전이는 액션·RPC 경유만.
- 기존 테스트를 깨뜨리지 마라.

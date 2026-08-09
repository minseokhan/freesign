# 약관 동의 게이트 계획

작성: 2026-08-09 · 상태: **계획(미착수)**
관련: `src/lib/legal.ts`, `src/app/(legal)/legal/*`, `docs/archive/LEGAL_ACCOUNT_PLAN.md`

---

## 0. 무엇을 만드나

지금 개인정보처리방침·이용약관·환불정책은 **사이드바 하단 링크로 읽을 수만 있다.** 동의를 받은 적도, 받은 기록도 없다.

이 계획은 두 가지를 나눠서 만든다.

| 문서 | 동의 시점 | 왜 그 시점인가 |
|---|---|---|
| 이용약관 · 개인정보처리방침 · 만 14세 이상 | **가입(첫 로그인) 직후** | 계정을 만드는 순간 개인정보 수집·이용이 시작된다. 서비스 이용의 전제라 여기서 받아야 한다 |
| 환불 및 청약철회 정책 | **Pro 결제 직전** | 전자상거래법은 청약철회 관련 사항을 *계약 체결 전*에 고지하도록 한다. 무료 사용자에게 받아봐야 법적 의미가 없고, 가입 화면의 동의 항목만 늘려 이탈을 키운다 |
| 마케팅 정보 수신 | 선택(가입 화면에 옵트인) | 필수로 묶으면 안 된다(개인정보보호법). 체크 안 해도 가입이 되어야 한다 |

---

## 1. 핵심 함정 — 체크박스는 게이트가 아니다

가장 먼저 못 박아야 할 설계 결정이다.

로그인 화면에 체크박스를 달고 "체크해야 버튼 활성화"로 만들면 **강제되지 않는다.** Google OAuth는 리다이렉트 흐름이라, `signInWithGoogle` Server Action을 직접 호출하거나 Supabase OAuth URL을 직접 열면 체크박스는 그냥 건너뛰어진다. 체크박스는 **고지·UX 장치일 뿐 보안 경계가 아니다.**

실제 게이트는 **세션이 생긴 뒤 서버에서** 건다.

```
로그인 화면 (체크박스: 고지 역할)
      ↓ Google OAuth
/auth/callback  ← 세션 생성
      ↓
(dashboard)/layout.tsx → requireConsent()
      ↓ 동의 기록 없음 or 버전이 낡음
/onboarding/consent  ← 여기서만 벗어날 수 있다
      ↓ Server Action이 동의 기록 INSERT
대시보드
```

**middleware에는 넣지 않는다.** CLAUDE.md 규약대로 middleware는 토큰 갱신 전용이고 보안 경계가 아니다.

`requireUser()` 자체에 넣지 않는 이유: 동의 화면과 `/api/*` 라우트도 `requireUser()`를 쓰기 때문에, 거기 넣으면 동의 화면 자신이 무한 리다이렉트에 빠진다. `requireConsent()`를 **별도 함수**로 두고 대시보드 레이아웃에서만 호출한다.

### 남는 구멍 (의도적으로 받아들임)

UI를 못 봐도 Server Action은 직접 호출할 수 있다. 즉 동의 없이 계약을 만드는 것이 이론적으로 가능하다. 이걸 막지 않는 이유는 **동의는 인가(authorization)가 아니라 증빙**이기 때문이다. 데이터 접근 권한은 이미 RLS가 `user_id`로 막고 있고, 동의 게이트가 하는 일은 "동의 없이 서비스를 계속 쓰지 못하게" 하는 것이다. 여기에 액션 단위 검사까지 넣으면 모든 Server Action에 분기가 붙는다 — 얻는 것에 비해 비싸다.

단 **결제는 예외다.** 결제는 실제 계약 체결이라 아래 4절처럼 라우트에서 직접 막는다.

---

## 2. 데이터 모델 (마이그레이션 0049)

```sql
create table public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document text not null check (document in ('terms','privacy','age14','refund','marketing')),
  version text not null,
  agreed boolean not null default true,
  agreed_at timestamptz not null default now(),
  ip_hash text,
  user_agent text
);
```

**설계 결정과 이유**

- **append-only.** 동의는 증빙이라 사후 수정되면 안 된다. `authenticated` 롤에서 `UPDATE`·`DELETE`를 revoke한다. 마케팅 수신을 철회하면 `agreed=false` 행을 **새로 넣는다**(가장 최근 행이 현재 상태).
- **`version`을 저장한다.** 약관을 개정하면 재동의를 받아야 하는데, 버전이 없으면 "누가 어느 문구에 동의했는지"를 증명할 수 없다.
- **`ip_hash`.** 원문 IP는 저장하지 않는다. `lib/request-meta.ts`의 `getHeadersIpHash()`를 그대로 쓴다(공개 청구서·서명 경계와 동일 정책).
- **`on delete cascade`.** 0047의 계정 삭제 정책과 일관되게 계정이 지워지면 같이 지워진다.
- **soft-delete 안 함.** 공용 쿼리 헬퍼의 `deleted_at` 규칙 대상이 아니다.

**RLS** — 규약대로 `USING` + `WITH CHECK` 둘 다:

```sql
alter table public.user_consents enable row level security;

create policy user_consents_select on public.user_consents
  for select using (user_id = (select auth.uid()));

create policy user_consents_insert on public.user_consents
  for insert with check (user_id = (select auth.uid()));

revoke update, delete on public.user_consents from authenticated;
```

인덱스: `create index on public.user_consents (user_id, document, agreed_at desc);` — "이 사용자의 이 문서 최신 동의"가 유일한 조회 패턴이다.

---

## 3. 버전 상수 — 시행일과 분리한다

여기 함정이 하나 있다. `src/lib/legal.ts`의 `termsEffectiveDate` 등이 지금 전부 `[미기입] 시행일` placeholder다. 이 값을 그대로 `version`으로 쓰면 **동의 기록에 `[미기입]`이 박힌다.**

그래서 **표시용 시행일과 별개로** 버전 상수를 둔다.

```ts
/** 동의 기록에 저장되는 문서 버전. 문구를 고치면 이 값을 올린다 — 올리면 재동의를 받는다. */
export const LEGAL_DOCUMENT_VERSIONS = {
  terms: "2026-08-09",
  privacy: "2026-08-09",
  age14: "2026-08-09",
  refund: "2026-08-09",
  marketing: "2026-08-09",
} as const;
```

이렇게 하면 사업자 정보(`LEGAL`)가 아직 미기입이어도 **동의 게이트를 먼저 출시할 수 있다.** 다만 결제를 켜는 시점에는 `listUnfilledLegalFields()`가 빈 배열이어야 한다는 기존 조건은 그대로다.

---

## 4. 결제 직전 환불정책 동의

`upgrade-cta.tsx`가 지금 `/api/billing/checkout`으로 바로 보낸다. 그 사이에 한 단계를 넣는다.

```
[Pro 시작하기] → /billing/checkout-consent
                   환불·청약철회 요약 + 전문 링크 + 체크박스 필수
                   ↓ Server Action: refund 동의 INSERT
                 /api/billing/checkout → Polar
```

그리고 **`/api/billing/checkout` 라우트 자체가 다시 검사한다.** 현재 버전의 `refund` 동의 행이 없으면 Polar로 넘기지 않고 `/billing/checkout-consent`로 되돌린다. 이 라우트는 링크로 여는 GET이라 주소만 알면 누구나 직접 칠 수 있기 때문이다 — 화면 단계만 두면 우회된다.

---

## 5. 작업 순서와 검증 기준

TDD 규약대로 각 단계에서 **테스트를 먼저 쓴다.**

| # | 단계 | 검증 |
|---|---|---|
| 1 | `legal.ts`에 `LEGAL_DOCUMENT_VERSIONS` 추가 | 모든 값이 `LEGAL_TODO`를 포함하지 않는다 |
| 2 | 마이그레이션 0049 (+ 로컬 적용, 타입 반영) | RLS 테스트: 남의 `user_id`로 INSERT 거부, 남의 행 SELECT 0건, `UPDATE`·`DELETE` 권한 거부 |
| 3 | `lib/consent.ts` — `getLatestConsents()`·`hasCurrentConsent()` | 버전이 낡으면 false, 없으면 false, 최신이면 true. `agreed=false` 최신 행이면 false |
| 4 | `recordConsent` Server Action | zod는 **선택 항목(marketing)만** 받는다. `user_id`는 `getUser()`, `version`은 서버 상수, `ip_hash`는 헤더에서 — client 입력 금지 |
| 5 | `/onboarding/consent` 페이지 | 필수 3종 미체크 시 제출 불가, 제출 후 대시보드로 |
| 6 | `requireConsent()` + 대시보드 레이아웃 게이트 | 동의 없는 세션이 `/contracts` 접근 시 `/onboarding/consent`로 리다이렉트. 동의 화면 자신은 리다이렉트되지 않는다(무한루프 회귀 테스트) |
| 7 | 로그인 화면 체크박스(고지용) | 체크 없이도 서버 게이트가 잡는다는 것을 테스트로 박제 — 체크박스는 보안 경계가 아님 |
| 8 | 결제 동의 단계 + checkout 라우트 재검사 | `refund` 동의 없이 `/api/billing/checkout` 직접 호출 시 Polar로 안 넘어간다 |
| 9 | 버전 올림 재동의 | 상수를 올리면 기존 사용자가 다시 동의 화면으로 간다 |
| 10 | E2E | 로그인 → 동의 → 대시보드, 그리고 재로그인 시 동의 화면이 다시 뜨지 않는다 |

**기존 사용자 처리** — 이미 가입한 계정은 동의 기록이 없으므로 다음 접속 때 동의 화면을 만난다. 이게 의도한 동작이다. 소급해서 동의한 것으로 채워 넣으면 안 된다(허위 증빙).

---

## 6. 아직 정하지 않은 것

- **만 14세 이상 확인을 필수 체크로 둘지, 별도 문구 고지로 갈지.** 프리랜서 대상이라 실무상 필수 체크가 일반적이지만 항목이 하나 더 늘어난다.
- **마케팅 수신 동의를 이번에 포함할지.** 보낼 메일이 아직 없으면 미루는 편이 낫다 — 안 쓸 동의를 받아두면 관리 대상만 는다.
- **동의 철회 UI.** 설정 화면에서 마케팅 수신만 끄는 정도면 충분한지, 아니면 계정 삭제(0048)로 갈음할지.

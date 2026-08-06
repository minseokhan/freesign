# 계획: 법적 고지 페이지 + 계정 삭제·데이터 내보내기

작성: 2026-08-03 · 상태: **✅ 완료(커밋 `dd22bcf`)** — 마이그레이션 `0047`·`0048` 원격 적용까지 확인됨(2026-08-06).
배경: 프로젝트 피드백 2번 항목("결제를 켜는 순간 법적 필수 항목이 비어 있다")
결론은 ADR-012에 박제됨.

> ⚠️ 7절의 남은 판단 3건(`src/lib/legal.ts` placeholder)은 **아직 살아 있고**
> `docs/SECURITY_NEXT_STEPS.md` 0절 3번이 그 정본이다. 이 문서는 배경 참고용이다.

## 실행 결과 (2026-08-03)

Step 1~11 전부 구현 완료. `npm run lint`·`npm run build:verify` 그린, 추가 테스트 40개 전부 통과.

계획 대비 달라진 점 3가지:

1. **마이그레이션 번호가 0046·0047 → `0047`·`0048`** — 작업 중 다른 세션이 `0046_invoice_share_tokens.sql`(청구 전달 경로)을 먼저 가져가서 비켰다.
2. **cascade 정비를 하드코딩 목록 → 동적 훑기로** — 계획은 8개 테이블 이름을 나열하는 것이었으나, 작업 도중 9번째 테이블(`invoice_share_tokens`)이 실제로 추가되는 것을 보고 "NO ACTION인 auth.users FK 전부"를 훑는 방식으로 바꿨다. 누락은 테스트가 잡는다.
3. **cascade만으로는 삭제가 실패한다는 사실을 발견** — 계획에 없던 문제다. `contracts.client_id`·`invoices.client_id`가 `ON DELETE RESTRICT`이고 `invoice_events.invoice_id`가 NO ACTION이라, `delete from auth.users` 한 줄로는 FK 위반이 난다. RPC 안에서 `invoice_events → invoices → contracts → clients` 순으로 명시 삭제하도록 고쳤다(ADR-012 3항).

또한 `"use server"` 파일은 async 함수만, 라우트 파일은 정해진 필드만 export할 수 있어 상수·순수 함수를 각각 `src/lib/validation/account.ts`·`src/lib/account-export.ts`로 분리했다.

---

## 0. 왜 지금인가

도메인 연결·Polar 프로덕션 전환을 하면 **바로 막히는** 항목들이다.

| 항목 | 근거 | 현재 상태 |
|---|---|---|
| 개인정보처리방침 공개 | 개인정보보호법 제30조 | ❌ 없음 |
| 국외 이전 고지 | 개인정보보호법 제28조의8 | ❌ 없음 (인프라가 **전부** 해외) |
| 이용약관 | 계약 관계 근거 | ❌ 없음 |
| 사업자 정보·청약철회 표시 | 전자상거래법 제10조·제13조 | ❌ 없음 |
| 계정 삭제 경로 | 개인정보보호법 파기 의무 + Google OAuth 정책 | ❌ 없음 (`settings/actions.ts`에 `updateProfile` 하나뿐) |
| 데이터 열람·이동 | 개인정보보호법 제35조 | ⚠️ `/api/reports` XLSX만 (Pro 전용·세금 한정) |

Google OAuth 앱을 프로덕션 심사에 올리려면 처리방침 URL과 계정 삭제 경로가 필요하다.

## 1. 확정된 결정 (2026-08-03 사용자 확인)

1. **사업자 정보는 아직 미등록** → 페이지·구조는 전부 만들되 값은 `src/lib/legal.ts` 한 곳에 placeholder로 모으고, 채워지지 않은 상태를 테스트가 감지한다. 결제 켜기 전 필수 작업으로 문서에 박는다.
2. **계정 삭제는 즉시 완전 삭제 + 결제 기록만 익명 보존.** 전자상거래법상 대금결제 기록 5년 보존 의무와 충돌하므로, 결제 이벤트만 `user_id`를 끊어 익명 테이블로 이관하고 나머지는 전부 물리 삭제.

## 2. 코드 조사에서 나온 제약 (계획의 근거)

### 2-1. `auth.users` FK에 cascade가 없는 테이블이 8개

`0001_schema.sql`·`0018_mutual_signature.sql`은 `references auth.users(id)`만 걸었고 `on delete cascade`가 없다. 0014 이후 테이블(`rate_limit_events`·`subscriptions`·`billing_events`·`usage_counters`·`dunning_reminders`·`recurring_invoices`·`contract_insights`)에만 cascade가 있다.

| 파일 | 라인 | 테이블 |
|---|---|---|
| `0001_schema.sql` | 19 | `clients` |
| `0001_schema.sql` | 35 | `contracts` |
| `0001_schema.sql` | 56 | `invoices` |
| `0001_schema.sql` | 78 | `contract_events` |
| `0001_schema.sql` | 90 | `invoice_events` |
| `0001_schema.sql` | 101 | `profiles` (PK) |
| `0018_mutual_signature.sql` | 15 | `signature_requests` |
| `0018_mutual_signature.sql` | 47 | `contract_signatures` |

→ 지금 `delete from auth.users`를 하면 **FK 위반으로 실패한다.** 마이그레이션이 선행돼야 한다.

### 2-2. `service_role`을 쓸 수 없다

Supabase 표준 경로인 `auth.admin.deleteUser()`는 `service_role` 키를 요구하는데, CLAUDE.md가 **요청 경로에서 `service_role` 절대 금지**(CLI 시드 전용)로 못 박고 있다.

→ 준수 가능한 유일한 경로는 `SECURITY DEFINER` 함수 안에서 `delete from auth.users where id = auth.uid()`. 세션 있는 경계이므로 시크릿 게이트는 불필요하고 `auth.uid()`가 곧 인가다(ADR-010의 세션 없는 경계 규칙과는 다른 사례).

### 2-3. Storage는 DB 삭제로 안 지워진다

`contract-artifacts` 버킷(`0004_storage.sql`)에 `{user_id}/...` 경로로 계약 PDF·원본 PDF·서명 이미지가 있다. `storage.objects`는 `auth.users` FK가 아니므로 계정을 지워도 파일은 남는다. 다행히 `0013_contract_hard_delete.sql:53`이 `contract_artifacts_delete_own` 정책을 이미 만들어놔서 **사용자 세션 권한으로 자기 파일을 지울 수 있다.**

### 2-4. `billing_events`도 cascade라 그냥 두면 같이 지워진다

`0024_billing.sql:50` — `user_id uuid not null references auth.users (id) on delete cascade`. 보존하려면 삭제 **전에** 별도 테이블로 이관해야 한다. 컬럼에 `not null` FK가 걸려 있어 "user_id만 NULL로" 방식은 스키마 변경이 더 커진다 → **FK 없는 익명 보존 테이블 신설**이 깔끔하다.

### 2-5. 활성 구독 상태로 지우면 Polar 결제가 계속된다

`subscriptions` 행을 지워도 Polar 쪽 구독은 살아 있다. 삭제를 막고 구독 해지를 먼저 요구해야 한다.

## 3. 성공 기준

1. `/legal/privacy`·`/legal/terms`·`/legal/refund` 3개 페이지가 렌더되고, 랜딩 footer·대시보드·**서명 페이지**에서 도달 가능하다.
2. 미인증 상태로 `/legal/*` 접근이 가능하다(로그인 전에 읽어야 하는 문서).
3. `GET /api/account/export`가 본인 데이터 전체를 JSON으로 반환하고, 토큰 해시·시크릿은 포함하지 않는다. Free 플랜도 가능하다.
4. 설정 페이지에서 확인 문구를 입력해 계정을 삭제하면, embedded-postgres 테스트에서 **해당 유저의 모든 도메인 테이블 행이 0**이 되고 **다른 유저 데이터는 무손상**이며 **`billing_records_retained`에 익명 행이 남는다.**
5. 활성 구독이 있으면 삭제가 거부되고 구독 해지 안내가 나온다.
6. `npm test`·`npm run lint`·`npm run build:verify` 그린.

## 4. 범위 밖 (이번에 안 함)

- 30일 유예 삭제(크론 스윕) — 즉시 삭제로 결정
- 쿠키 동의 배너 — PostHog를 필수 기능으로 두지 않으므로 처리방침 고지로 갈음. 유럽 사용자 유입이 생기면 재검토
- 사업자 정보 실제 값 채우기 — 등록 후 별건
- 개인정보 보호책임자 지정 문구의 실명·연락처 — placeholder와 함께 처리

---

## 5. 작업 단계

### Step 1 — 법적 문구 상수 분리

**파일:** `src/lib/legal.ts` (신규), `src/lib/__tests__/legal.test.ts` (신규)

한 곳에 모으는 이유: 사업자 등록 후 **파일 하나만 고치면** 3개 페이지와 footer가 동시에 갱신되도록.

```ts
export const LEGAL = {
  serviceName: "매듭",
  operatorName: "TODO_사업자_등록_후_기입",
  businessRegistrationNumber: "TODO_사업자_등록_후_기입",
  mailOrderSalesNumber: "TODO_통신판매업_신고_후_기입",
  address: "TODO_사업자_등록_후_기입",
  contactEmail: "TODO_지원_메일_주소",
  privacyOfficer: { name: "TODO", email: "TODO" },
  privacyEffectiveDate: "2026-__-__",
  termsEffectiveDate: "2026-__-__",
} as const;

export function hasUnfilledLegalPlaceholders(): boolean { /* "TODO" 포함 여부 */ }
```

> **검증:** 테스트가 `hasUnfilledLegalPlaceholders()`를 확인하고, 미채움이면 *실패가 아니라* 명시적으로 "결제 활성화 전 필수" 메시지를 남기는 `it.skip` 대신 **별도 테스트 1개가 현재 미채움임을 단언**한다. 값을 채우면 그 테스트가 깨지면서 "이제 페이지 문구도 재확인하라"는 신호가 된다.

### Step 2 — 개인정보처리방침

**파일:** `src/app/(legal)/legal/privacy/page.tsx`, `src/app/(legal)/layout.tsx`, 테스트

`(legal)` 라우트 그룹을 새로 만든다. `(dashboard)`는 인증이 필요하고 `(public)`은 서명 전용 레이아웃이라 둘 다 안 맞는다.

담을 내용 — **코드에서 실제로 수집하는 것만** 적는다(허위 고지 방지):

| 구분 | 항목 | 출처 |
|---|---|---|
| 계정 | 이메일, 이름, Google 계정 식별자 | Google OAuth |
| 프로필 | 표시명, 은행명·계좌번호·예금주, 기본 원천징수 유형 | `profiles` |
| 이용자가 입력한 제3자 | 클라이언트 이름·이메일·전화·메모 | `clients` |
| 서명 | 수신자 이메일·이름, 서명자 이메일·이름, 서명 이미지, 동의 기록·감사추적(`consent`·`meta`) | `signature_requests`·`contract_signatures` |
| 결제 | Polar 고객·구독 식별자, 결제 이벤트 | `subscriptions`·`billing_events` |
| 자동 수집 | 제품 분석 이벤트, 서버 로그 | PostHog·Vercel |

**빠뜨리면 안 되는 두 가지:**

1. **국외 이전 고지** — 처리위탁·국외이전 대상이 전부 해외다. 표로 명시:
   Supabase(DB·인증·스토리지), Vercel(호스팅), Anthropic(AI 계약서 초안·PDF 파싱), Resend(메일 발송), Polar(결제), PostHog(분석), freeTSA.org(RFC 3161 타임스탬프).
   각각 이전 항목·목적·보유기간·거부 방법.
2. **역할 구분** — 클라이언트·서명자 정보에 대해서는 **이용자(프리랜서)가 개인정보처리자이고 매듭은 수탁자**라는 관계를 명시. 이게 없으면 제3자 정보 수집 근거가 불명확해진다.

그 외: 처리 목적, 보유기간(계정 삭제 시 즉시 파기 / 결제 기록 5년), 파기 절차, 정보주체 권리와 행사 방법(→ `/settings`의 내보내기·삭제로 연결), 보호책임자, 안전성 확보 조치(RLS·private 버킷·전송 암호화).

### Step 3 — 이용약관

**파일:** `src/app/(legal)/legal/terms/page.tsx`, 테스트

조항: 목적·정의 / 계정과 Google 로그인 / 요금제·결제·자동갱신·해지(Polar) / **AI 계약서는 초안이며 법률 자문이 아님**(기존 면책 문구와 동일 톤) / **전자서명 입증력의 단계적 한계** — `docs/LEGAL_SIGNATURE.md`의 `record`/`mutual` 구분을 사용자 언어로 요약 / 데이터 소유권은 이용자에게 있음·백업 책임 / 금지 행위 / 서비스 변경·중단 / 책임 제한 / 준거법·관할.

전자서명 조항은 특히 중요하다 — "공인 전자서명이 아니다"를 약관에서 한 번 더 못 박아야 분쟁 시 방어된다.

### Step 4 — 청약철회·환불 정책 + 사업자 정보 표시

**파일:** `src/app/(legal)/legal/refund/page.tsx`, 테스트

구독 기준 환불 조건, 자동갱신 해지 방법(`/billing` → Polar 포털), 환불 문의 경로. 하단에 `LEGAL` 상수 기반 사업자 정보 블록.

> **열린 항목:** 구체적 환불 기준(예: 결제 후 7일 이내 미사용분 전액, 사용분 일할 계산 등)은 사업자 등록 시점에 확정. 초안은 보수적으로 작성하고 TODO 표시.

### Step 5 — 링크 노출

| 위치 | 파일 | 방식 |
|---|---|---|
| 랜딩 footer | `src/app/page.tsx:151` 근처 | 기존 footer에 3개 링크 추가 |
| 대시보드 | `src/components/app-sidebar.tsx` 하단 | 작은 텍스트 링크 (nav 항목 아님) |
| **서명 페이지** | `src/app/(public)/sign/layout.tsx` | **필수** — 비로그인 서명자의 이메일·감사추적을 수집하므로 처리방침 고지 링크가 있어야 한다 |
| 설정 | `src/app/(dashboard)/settings/page.tsx` | 내보내기·삭제 섹션 옆 |

### Step 6 — 데이터 내보내기

**파일:** `src/app/api/account/export/route.ts` + 테스트, `src/lib/rate-limit.ts` 수정

`GET /api/account/export` → `application/json` 첨부 다운로드.

- **Free 포함** — 열람권은 요금제로 막을 수 없다 (`/api/reports`의 Pro 게이트와 다르다)
- RSC가 아닌 라우트 핸들러인 이유: 파일 다운로드 응답이라 CLAUDE.md의 "읽기는 RSC" 규칙 대상이 아니다(기존 `/api/reports`와 동일 패턴)
- 포함: 프로필, 클라이언트, 계약(+이벤트), 인보이스(+이벤트), 서명 요청, 서명 기록, 반복 인보이스, 독촉, 인사이트, 구독·결제 이벤트 요약
- **제외: `token_hash`, TSA 토큰 원문, 서명 이미지 바이너리(경로만)** — 토큰 해시가 유출되면 서명 링크 검증 경계가 약해진다
- 레이트리밋 `accountExport: { max: 3, windowSeconds: 3600 }` 추가 — 전체 데이터 덤프는 비싼 쿼리다

### Step 7 — 마이그레이션 0046: FK cascade

**파일:** `supabase/migrations/0046_account_delete_cascade.sql`

2-1의 8개 테이블에 대해 기존 FK 제약을 drop 후 `on delete cascade`로 재생성. 제약 이름은 Postgres 기본 규칙(`<table>_user_id_fkey`, profiles는 PK 컬럼이므로 확인 필요)이므로 **`information_schema`에서 조회해 동적으로 처리**하지 말고, 마이그레이션 작성 전에 실제 이름을 조회해 명시적으로 적는다(0004·0013이 쓰는 존재 여부 가드 패턴 유지).

### Step 8 — 마이그레이션 0047: 익명 보존 테이블 + 삭제 RPC

**파일:** `supabase/migrations/0047_account_deletion.sql`

```
create table billing_records_retained (
  id bigint generated always as identity primary key,
  polar_customer_id text,
  polar_subscription_id text,
  event_type text not null,
  status text,
  occurred_at timestamptz not null,
  retained_at timestamptz not null default now()
);
-- auth.users FK 없음(그게 요점). RLS 활성 + SELECT 정책 없음 = 아무도 못 읽음.
-- 법적 보존 목적이므로 운영자가 DB 콘솔로만 접근한다.
```

`billing_events.meta` jsonb는 **이관하지 않는다** — 어떤 PII가 들어 있는지 보증할 수 없으므로 화이트리스트 컬럼만 옮긴다.

```
create function delete_own_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  -- 활성 구독이 남아 있으면 거부(Polar 결제가 계속되므로).
  if exists (select 1 from subscriptions
             where user_id = v_uid and status = 'active') then
    raise exception 'active_subscription';
  end if;

  -- 결제 기록만 익명 이관(전자상거래법 대금결제 기록 보존).
  insert into billing_records_retained (...)
  select s.polar_customer_id, e.polar_subscription_id, e.event_type, e.status, e.created_at
  from billing_events e
  left join subscriptions s on s.user_id = e.user_id
  where e.user_id = v_uid;

  -- 0046의 cascade가 나머지를 전부 끌고 간다.
  delete from auth.users where id = v_uid;
end $$;

revoke all on function delete_own_account() from public, anon;
grant execute on function delete_own_account() to authenticated;
```

`security definer` + `auth.uid()` 인가라 파라미터가 없다 — **삭제 대상을 클라이언트가 지정할 수 없게** 하는 게 핵심이다.

### Step 9 — Server Action + UI

**파일:** `src/app/(dashboard)/settings/actions.ts` 수정, `src/components/account-delete-section.tsx` 신규, `src/app/(dashboard)/settings/page.tsx` 수정

```
export async function deleteAccount(input: unknown)
// zod allowlist: { confirm: z.literal("계정을 삭제합니다") }
```

실행 순서와 그 이유:

1. `requireUser()` → 확인 문구 검증
2. **Storage 먼저** — `{user_id}/` 하위 객체 나열 후 `remove()`. 실패하면 **중단하고 에러 반환**(DB는 건드리지 않음)
3. `rpc("delete_own_account")` — 실패 시 에러 반환
4. `signOut()` → `/` 리다이렉트

> **트레이드오프(명시적 선택):** 2와 3 사이에 원자성이 없다. 순서를 뒤집으면(DB 먼저) 세션이 죽은 뒤 Storage를 지워야 해서 서명 이미지·계약 PDF가 **영구히 남는다** — 개인정보 파기 관점에서 이게 더 나쁘다. 반대로 지금 순서는 "파일은 지웠는데 계정은 남음"이 될 수 있는데, 이건 사용자가 재시도하면 복구된다(파일은 이미 없으니 2단계는 성공). **덜 나쁜 실패**를 고른 것이다. 3단계 실패는 반드시 `captureServerException`으로 관측한다.

UI — 설정 페이지 하단 "위험 구역":
- 삭제 전 내보내기 유도 링크 (`/api/account/export`)
- 무엇이 지워지는지 목록 + **되돌릴 수 없음** 경고
- 확인 문구 정확 입력 시에만 버튼 활성화
- 활성 구독이면 버튼 대신 "먼저 구독을 해지해 주세요" + `/billing` 링크 (RSC에서 플랜 조회해 분기)

### Step 10 — 테스트 (TDD: 각 Step 전에 작성)

| 파일 | 검증 |
|---|---|
| `src/lib/__tests__/legal.test.ts` | 상수 무결성, placeholder 미채움 단언 |
| `src/app/(legal)/legal/*/__tests__/page.test.tsx` | 3개 페이지 렌더, 국외이전 표 존재, 사업자정보 블록 존재 |
| `src/app/api/account/export/__tests__/route.test.ts` | 미인증 401 / 본인 데이터만 / `token_hash` 미포함 / 레이트리밋 초과 429 / Free 허용 |
| `src/app/(dashboard)/settings/__tests__/actions.test.ts` (확장) | 미인증 거부 / 확인 문구 불일치 거부 / 활성 구독 시 차단 / **Storage 실패 시 RPC 미호출** / 성공 시 signOut 호출 |
| `src/lib/db/__tests__/account-delete.test.ts` (신규) | **embedded-postgres 실 SQL 검증** |

마지막이 이 계획의 핵심 게이트다. `src/test/pg.ts`의 `applyMigrations`가 `supabase/migrations` 전체를 실제로 적용하므로(`src/lib/db/__tests__/seed.test.ts`가 쓰는 방식), 0046·0047을 진짜 Postgres에 걸고 확인할 수 있다:

1. 유저 A·B를 만들고 각각 클라이언트·계약·인보이스·이벤트·서명요청·서명·결제이벤트를 넣는다
2. A로 `delete_own_account()` 실행
3. **A의 모든 도메인 테이블 행이 0**
4. **B의 모든 행이 그대로** (cascade 범위 오류 검출)
5. `billing_records_retained`에 A의 결제 이벤트 수만큼 행이 있고 `user_id` 컬럼 자체가 없다
6. A가 활성 구독이면 `active_subscription` 예외로 거부되고 **아무것도 지워지지 않는다**

### Step 11 — 문서 갱신

- `docs/ADR.md` — ADR-012: 계정 삭제 경계(`service_role` 대신 `auth.uid()` DEFINER RPC), 결제 기록 익명 보존, Storage-먼저 순서의 트레이드오프
- `docs/ARCHITECTURE.md` — 데이터 삭제 규칙에 계정 삭제 추가 (계약 물리삭제 ADR-008 항목 옆)
- `CLAUDE.md` — 필요 시 한 줄. 규칙이 늘지 않으면 추가하지 않는다
- `docs/SECURITY_NEXT_STEPS.md` — "결제 활성화 전 사업자 정보 채우기"를 잔여 항목에 추가

---

## 6. 실행 순서 요약

```
1. Step 1 (상수) → 검증: legal.test.ts 그린
2. Step 2~4 (3개 페이지) → 검증: 페이지 렌더 테스트 그린
3. Step 5 (링크) → 검증: 서명 레이아웃 포함 4곳에서 도달
4. Step 6 (내보내기) → 검증: route 테스트 5케이스 그린
5. Step 7~8 (마이그레이션) → 검증: account-delete.test.ts 6케이스 그린
6. Step 9 (액션·UI) → 검증: settings actions 테스트 5케이스 그린
7. 전체 → 검증: npm test + lint + build:verify 그린
8. Step 11 (문서)
9. 원격 Supabase에 0046·0047 apply_migration (main 커밋과 별개 — 코드 먼저, DB 나중 순서는
   이번 건에선 반대다: 코드가 먼저 배포되면 아직 없는 함수를 호출한다. DB 먼저 적용할 것)
```

> 9번 주의: 원격은 git 커밋만으로 반영되지 않는다. Supabase MCP `apply_migration` 수동 실행 필요.

## 7. 남은 판단 (실행 중 사용자 확인 필요)

1. **환불 조건 구체값** — Step 4에서 초안을 보수적으로 쓰되 확정은 사업자 등록 후
2. **지원 연락처 이메일** — 처리방침·약관·환불 3곳에 들어간다. 도메인 확정 후 `support@` 형태로 채울지
3. **서비스 시행일** — 실제 공개일로 채움

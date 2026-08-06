# Polar 프로덕션 결제 전환 (로컬 테스트 → 프로덕션)

> **다른 세션에서 이 문서만 읽고 진행할 수 있게 쓴 실행 문서.**
> 배경·정책은 `docs/archive/BILLING_PLAN.md`, 보안 경계는 `docs/ADR.md` ADR-010,
> 미해결 항목은 `docs/SECURITY_NEXT_STEPS.md` 4절.

작성일: 2026-08-04

---

## 0. 지금까지 끝난 것 (2026-08-04 실측)

| 항목 | 상태 |
|---|---|
| Polar **프로덕션 조직** `Maedeup` | ✅ 생성 + **Account approved** (심사 통과) |
| Payout account (Stripe) | ✅ connected |
| Identity verification | ✅ verified |
| 프로덕션 상품 (Pro) | ✅ 생성 — **통화·가격 재확인 필요**(아래 2-1) |
| 프로덕션 Access Token | ✅ 발급 (`No expiration`, 스코프는 아래 참고) |
| 프로덕션 Webhook 엔드포인트 | ✅ `https://maedeup.app/api/billing/webhook` |
| Vercel 프로덕션 `POLAR_*` | ❌ **없음** — 그래서 결제가 아직 꺼져 있다 |
| DB `billing_config` | ⚠️ **sandbox(ngrok) 시크릿**을 들고 있다 |

즉 **코드는 다 준비됐고, env 4개 + DB 시크릿만 넣으면 켜진다.**

### 반드시 이해하고 시작할 것 — 시크릿 슬롯은 하나뿐이다

`billing_config`는 webhook 시크릿을 **한 개만** 저장한다(`secret_sha256`).
로컬(ngrok)과 프로덕션이 **같은 원격 DB**를 보므로 **동시에 둘 다 동작할 수 없다.**

```
로컬 테스트 중  →  billing_config = sandbox 시크릿  →  프로덕션 webhook 전량 거부
프로덕션 운영중 →  billing_config = prod 시크릿     →  로컬 webhook 전량 거부
```

전환할 때마다 `set_billing_webhook_secret()`을 다시 돌린다. 이건 버그가 아니라
"세션 없는 경계는 시크릿 게이트 DEFINER RPC로만"(ADR-010)의 필연적 결과다.

---

## 1. 로컬 테스트 (프로덕션 전환 전에)

sandbox 환경에서 checkout → 결제 → webhook → `subscriptions` pro 전환까지 확인한다.

### 1-1. 전제

- Polar **sandbox** 조직에 엔드포인트 `freesign_dev`가 살아 있다
  → `https://finale-fanciness-cadmium.ngrok-free.dev/api/billing/webhook`
  (ngrok **무료 고정 도메인**이라 재시작해도 주소가 유지된다)
- `.env.local`에 sandbox `POLAR_ACCESS_TOKEN`·`POLAR_WEBHOOK_SECRET`·`POLAR_PRODUCT_ID`·`POLAR_SERVER=sandbox`

### 1-2. DB를 sandbox 시크릿으로 맞춘다

프로덕션을 켠 뒤라면 DB가 prod 시크릿을 들고 있으므로 되돌려야 한다.
로컬 값과 DB 해시가 같은지 먼저 대조한다(값을 노출하지 않고 확인):

```bash
grep '^POLAR_WEBHOOK_SECRET=' .env.local | cut -d= -f2- | tr -d '\n' | shasum -a 256
```
```sql
-- supabase.com/dashboard/project/jbfxkcjeoqwcdsxuemug/sql/new
select secret_sha256, updated_at from billing_config;
```

두 해시가 다르면 되돌린다:
```sql
select set_billing_webhook_secret('<.env.local의 POLAR_WEBHOOK_SECRET 값>');
```

### 1-3. ngrok + dev 서버

```bash
ngrok http --domain=finale-fanciness-cadmium.ngrok-free.dev 3000   # 터미널 1
npm run dev                                                        # 터미널 2
```

### 1-4. 결제 흐름 확인

1. `/dev/test-login` → `/billing`
2. 업그레이드 → Polar sandbox 체크아웃 (sandbox는 실제 청구 없음)
3. 결제 완료 → `/settings?checkout=success` 로 복귀
4. **판정은 화면이 아니라 DB**:
   ```sql
   select user_id, plan, status, polar_customer_id, updated_at
     from subscriptions order by updated_at desc limit 5;
   ```
   본인 `user_id`로 `plan='pro'`, `status='active'` 행이 생기면 성공.
5. 게이트 해제 확인 — 새 계약 2건째 생성, 리포트 Excel 내보내기가 열리는지
6. 구독 관리 — `/billing`의 포털 버튼이 Polar 고객 포털로 넘어가는지
   (실패하면 액세스 토큰에 **`customer_sessions:write`** 스코프가 없는 것)

### 1-5. webhook이 안 들어올 때

```bash
# ngrok 웹 인터페이스에서 요청 도달 여부 확인
open http://127.0.0.1:4040
```
- ngrok에 요청 자체가 없다 → Polar 엔드포인트 URL·이벤트 구독 확인
- 요청은 왔는데 401/403 → `.env.local`의 `POLAR_WEBHOOK_SECRET` 불일치 (SDK 서명 검증)
- 200인데 `subscriptions`에 반영 안 됨 → `billing_config` 해시 불일치 (RPC 게이트)

---

## 2. 프로덕션 전환

### 2-1. 켜기 전 확인 3가지

**① 상품** — Polar Products에서 Pro 상품 열기
- 통화 **KRW**, 가격 **14,900**, 주기 **Monthly recurring**
- 🔴 **통화와 결제주기는 나중에 못 바꾼다.** 기존 구독자를 다른 통화 상품으로
  옮길 수 없다(Polar: "New products must share the same currency"). 가격 숫자는
  나중에 바꿔도 되고, 기존 구독자는 옛 가격으로 grandfathered된다.
- **Product ID 복사**

**② Webhook 엔드포인트** — Settings → Webhooks
- URL `https://maedeup.app/api/billing/webhook`
- Format **Raw**
- 이벤트 **4종**: `subscription.active` · `subscription.updated` ·
  `subscription.canceled` · `subscription.revoked`
  (`subscription.revoked` 누락 시 **해지한 사용자가 Pro로 남는다**)
- **Secret 확보** — 상세 화면에서 reveal. 못 찾으면 Regenerate(프로덕션을 켜기 전이면 안전)

**③ 액세스 토큰**
- `Expiration = No expiration` (30일짜리면 30일 뒤 결제가 조용히 죽는다)
- 스코프: `checkouts:read/write` · `customers:read/write` ·
  **`customer_sessions:write`** · `products:read` · `subscriptions:read`
- `Select all` 금지 (`payouts:write`까지 켜져 유출 시 정산 계좌 변경이 가능해진다)

### 2-2. 🔴 순서 — 반드시 DB 먼저

재배포 전까지 프로덕션에 `POLAR_*`이 없어 `isPolarConfigured()`가 false다.
즉 **결제가 발생할 수 없는 상태**라 이벤트 유실 구간이 없다.
반대로 하면 "결제는 됐는데 DB가 거부하는" 창이 생긴다.

**① DB** — supabase.com/dashboard/project/jbfxkcjeoqwcdsxuemug/sql/new
```sql
select set_billing_webhook_secret('<프로덕션 whsec_... 값>');
```

**② Vercel 환경변수 4개** (시크릿이 로그에 남지 않게 본인 터미널에서)
```bash
cd ~/freesign
vercel env add POLAR_ACCESS_TOKEN production
vercel env add POLAR_PRODUCT_ID production
vercel env add POLAR_WEBHOOK_SECRET production
vercel env add POLAR_SERVER production        # 값: production
```

**③ 재배포**
```bash
cd ~/freesign && vercel --prod
```

### 2-3. 검증

`/billing`에서 실제로 결제한다. 둘 중 하나:
- Polar에서 **100% 할인 코드**를 만들어 무료로 전 과정 확인 (권장)
- 본인 카드로 **₩14,900 실결제** 후 환불 — 가장 정직한 검증

```sql
select user_id, plan, status, polar_customer_id, updated_at
  from subscriptions order by updated_at desc limit 5;
```
본인 `user_id`로 `plan='pro'`·`status='active'`가 생기면 전 체인이 동작한 것이다.

실패하면 Vercel 런타임 로그에서 `unauthorized billing webhook call` 을 찾는다
→ ①의 DB 시크릿과 ②의 `POLAR_WEBHOOK_SECRET`이 어긋난 것.

### 2-4. 🔴 킬 스위치

```bash
cd ~/freesign
vercel env rm POLAR_PRODUCT_ID production && vercel --prod
```

`isPolarConfigured()`는 `POLAR_ACCESS_TOKEN`·`POLAR_WEBHOOK_SECRET`·`POLAR_PRODUCT_ID`
**3개가 모두 있어야** true다(`src/lib/env.ts:187`). 하나만 지우면 결제가 깔끔히 꺼지고,
500이 아니라 `/billing?portal=not_configured` 안내 화면으로 빠진다.

---

## 3. 켜기 전에 정해야 할 정책 2가지 (코드 미구현)

실제 과금이 시작되기 전에 결정하고 구현해야 한다.

**① 결제 실패(`past_due`) 처리 — 현재 코드에 없음**
`src/app/api/billing/webhook/route.ts`는 `active`/`updated`/`canceled`/`revoked`
**4개만** 받는다. 카드 결제가 실패해 `past_due`가 되면 앱은 아무것도 하지 않고
사용자는 **Pro를 계속 쓴다.** 즉시 강등할지, `current_period_end`까지 유예할지 결정 필요.

**② 다운그레이드 데이터 처리**
Pro에서 만든 새 계약 N건이 Free로 강등되면? 기존 계약은 읽기전용 유지(삭제 안 함),
신규 생성만 무료 1건 한도 재적용 — 방향은 잡혔으나 미확정·미구현.

---

## 4. 사업 측면 마찰 (이미 조사됨, `docs/archive/BILLING_PLAN.md`)

- ⚠️ **결제수단**: 한국 발급 Visa/Master **카드만**. 카카오페이·네이버페이·계좌이체 미지원
- ⚠️ **세금계산서**: Polar가 미국 법인 MoR이라 **홈택스 세금계산서 발급 불가**.
  타깃이 경비처리 니즈가 큰 프리랜서라 이탈 요인이 될 수 있다. 비중이 높으면
  국내 PG(토스페이먼츠·페이플) 이전 재평가.
- **통신판매업 신고·사업자등록** — Polar가 MoR로 세금을 처리해도 국내 사업자 의무는
  별개다. 세무사 확인 권장(이 문서의 범위 밖).

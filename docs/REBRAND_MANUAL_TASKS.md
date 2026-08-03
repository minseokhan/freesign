# 매듭 리브랜딩 — 사람이 직접 해야 하는 작업 (클릭 단위 런북)

> 코드·문서·컬러·로고는 전부 자동 처리했다. 이 문서는 **외부 콘솔 로그인이 필요해
> 에이전트가 대신할 수 없는 항목**만 모았다. 위에서 아래로 순서대로 하면 된다.
> 전체 맥락은 `docs/REBRAND_PLAN.md`.

작성일: 2026-08-03

> 콘솔 UI는 수시로 바뀐다. **직접 링크가 우선**이고, 메뉴 이름이 다르면 괄호 안의
> 대체 이름을 찾으면 된다.

---

## 자주 쓰는 값 (복사해서 쓰세요)

```
도메인            maedeup.app
Vercel 프로젝트    hanminseoks-projects / freesign   (아직 개명 전)
Supabase 프로젝트  freesign  (ref: jbfxkcjeoqwcdsxuemug)
앱 URL            https://maedeup.app
발신 주소          매듭 <no-reply@maedeup.app>
OAuth 콜백        https://maedeup.app/auth/callback
Polar webhook     https://maedeup.app/api/billing/webhook
```

---

## ⚠️ 순서가 중요한 이유

`freesign.vercel.app`으로 이미 발급된 **서명 링크·청구서 공개 링크**가 살아 있다.

1. 새 도메인이 **먼저 뜨게** 만든다 (DNS → 인증)
2. 그 다음에 `NEXT_PUBLIC_SITE_URL`을 새 도메인으로 → **이후 발급되는** 링크만 새 도메인
3. 구 도메인은 **지우지 않는다.** 기존 링크가 다 만료될 때까지 그대로 둔다.

`NEXT_PUBLIC_SITE_URL`을 DNS보다 먼저 바꾸면 **그 사이에 발급된 링크가 죽는다.**

---

## ✅ 이미 끝난 것 (확인만)

- Vercel 프로젝트에 `maedeup.app` · `www.maedeup.app` **도메인 추가 완료**
  (`freesign.vercel.app`과 공존. 리다이렉트 없이 셋 다 독립 응답)
- 코드·문서 전체 브랜드 문자열 교체, 컬러 남색 전환, 로고·파비콘 교체, 프로덕션 배포

---

# 1. Cloudflare — DNS 레코드 추가 🔴 최우선

**이거 하나만 하면 `maedeup.app`이 뜬다.**

### 클릭 경로

1. https://dash.cloudflare.com 접속 → 로그인
2. 첫 화면 목록에서 **`maedeup.app`** 클릭
   - 목록이 안 보이면 왼쪽 사이드바 **Account Home** → **Domains**(또는 **Websites**)
3. 왼쪽 사이드바에서 **DNS** 클릭 → 하위의 **Records** 클릭
   - 직접 링크: `https://dash.cloudflare.com/?to=/:account/maedeup.app/dns/records`
4. 오른쪽 위 파란 버튼 **`+ Add record`** 클릭

### 레코드 1 — 루트

| 입력란 | 값 |
|---|---|
| Type | `A` |
| Name | `@` |
| IPv4 address | `76.76.21.21` |
| Proxy status | 토글을 눌러 **회색 구름 `DNS only`** 로 |
| TTL | `Auto` |

**Save** 클릭.

### 레코드 2 — www

다시 **`+ Add record`** 클릭.

| 입력란 | 값 |
|---|---|
| Type | `CNAME` |
| Name | `www` |
| Target | `cname.vercel-dns.com` |
| Proxy status | **회색 구름 `DNS only`** |
| TTL | `Auto` |

**Save** 클릭.

> 🔴 **프록시(주황 구름)를 반드시 끄세요.** 기본값이 켜짐(주황)입니다.
> 켜두면 Vercel의 SSL 인증서 발급이 실패하거나 리다이렉트 루프가 생깁니다.
> Type을 `A`/`CNAME`으로 고르면 구름 아이콘이 나타나고, **클릭하면 주황↔회색이 토글**됩니다.

### 확인

1~5분 뒤:
```bash
dig +short maedeup.app          # 76.76.21.21 이 나오면 성공
cd ~/freesign && vercel domains inspect maedeup.app
```
또는 브라우저에서 https://maedeup.app → 매듭 랜딩이 뜨면 완료.

인증서 발급까지 몇 분 더 걸릴 수 있습니다. 그동안 SSL 경고가 떠도 정상입니다.

---

# 2. Resend — 발신 도메인 인증

안 하면 **클라이언트에게 메일이 안 갑니다**(본인 주소로만 발송됨).
상세 배경: `docs/EMAIL_DOMAIN_SETUP.md`

### 2-1. Resend에 도메인 등록

1. https://resend.com/domains 접속 → 로그인
2. 오른쪽 위 **`Add Domain`** 클릭
3. **Domain** 칸에 `maedeup.app` 입력
4. **Region** 선택 (아무거나 무방. 이 선택에 따라 아래 MX 값의 리전 문자열이 달라짐)
5. **`Add`** 클릭
6. → DNS 레코드 표가 나타납니다. **이 화면을 열어둔 채** 다음 단계로.

### 2-2. Cloudflare에 레코드 추가

1번과 같은 경로로 Cloudflare **DNS → Records** 로 가서 **`+ Add record`** 로 아래를 추가.

| Type | Name (Cloudflare에 넣을 값) | 값 | Proxy |
|---|---|---|---|
| `MX` | `send` | `feedback-smtp.<region>.amazonses.com` · Priority `10` | — |
| `TXT` | `send` | `v=spf1 include:amazonses.com ~all` | — |
| `TXT` | `resend._domainkey` | Resend 화면의 긴 공개키 그대로 | — |
| `TXT` | `_dmarc` (권장) | `v=DMARC1; p=none; rua=mailto:hanms10171017@gmail.com` | — |

> ⚠️ **이름 확장 함정.** Resend 화면은 `send.maedeup.app`처럼 전체 주소를 보여주지만,
> Cloudflare에는 **`send`만** 넣어야 합니다. 전체를 넣으면
> `send.maedeup.app.maedeup.app`이 되어 인증이 영영 통과하지 않습니다.
> `_dmarc`도 마찬가지로 `_dmarc`만.

> DKIM 공개키는 매우 길어서 화면에서 잘려 보입니다. Resend의 **복사 아이콘**을 눌러
> 클립보드로 가져오세요. 손으로 옮겨 적지 마세요.

> MX·TXT는 원래 프록시 대상이 아니라 구름 아이콘이 안 보일 수 있습니다. 정상입니다.

### 2-3. 검증

1. Resend의 도메인 상세 화면으로 돌아가 **`Verify DNS Records`** 클릭
2. 상태가 **`Verified`** (초록)가 될 때까지 기다립니다. 보통 수 분, 길면 수 시간.
3. `Pending`이면 시간을 더 주고 다시 Verify. `Failed`면 이름 확장 함정부터 의심.

### 2-4. 성공 기준 — 화면 문구가 아니라 이벤트 로그

3번(Vercel `EMAIL_FROM`)까지 끝낸 뒤, 본인이 아닌 주소로 인보이스를 하나 발송하고
Supabase SQL 에디터에서 확인:

```sql
select event_type, created_at, meta from invoice_events
 where invoice_id = '<인보이스 id>' order by created_at desc;
```
`invoice.sent`가 남아 있으면 성공. 실패하면 Vercel 런타임 로그의
`[invoice] 청구 안내 이메일 발송 실패:` 뒤에 Resend가 준 사유가 찍혀 있습니다.

---

# 3. Vercel — 환경 변수 갱신 (1·2번 완료 후)

### 방법 A — 대시보드 (권장)

1. https://vercel.com/hanminseoks-projects/freesign/settings/environment-variables 접속
   - 직접 가려면: https://vercel.com → 프로젝트 **`freesign`** 클릭 →
     위쪽 탭 **Settings** → 왼쪽 사이드바 **Environment Variables**

2. **`NEXT_PUBLIC_SITE_URL` 수정**
   - 목록에서 `NEXT_PUBLIC_SITE_URL` 행을 찾아 오른쪽 **`⋯`(점 3개)** → **Edit**
   - Value를 `https://maedeup.app` 으로 교체 (끝에 `/` 붙이지 말 것)
   - Environment는 **Production** 체크 유지 → **Save**

3. **`EMAIL_FROM` 신규 추가** (Resend가 `Verified`가 된 뒤에만!)
   - 같은 화면 위쪽 입력 폼에서
   - Key: `EMAIL_FROM`
   - Value: `매듭 <no-reply@maedeup.app>`  ← 꺾쇠 포함, 그대로
   - Environment: **Production** 만 체크 → **Save**

4. **재배포해야 반영됩니다.**
   - 위쪽 탭 **Deployments** → 맨 위 배포 행의 **`⋯`** → **Redeploy** → **Redeploy** 확인

### 방법 B — 터미널

```bash
cd ~/freesign
vercel env rm NEXT_PUBLIC_SITE_URL production
vercel env add NEXT_PUBLIC_SITE_URL production      # 값: https://maedeup.app
vercel env add EMAIL_FROM production                # 값: 매듭 <no-reply@maedeup.app>
vercel --prod                                        # 재배포
```

> 참고: 현재 프로덕션에 `EMAIL_FROM`은 **없습니다**(테스트 주소로 폴백 중).
> `POLAR_*` 변수들도 프로덕션에 없습니다 — 결제를 프로덕션으로 올릴 때 별도 작업입니다.

---

# 4. Supabase — Auth Redirect URL

이걸 안 하면 새 도메인에서 **Google 로그인 후 리다이렉트가 차단**됩니다.
앱은 `NEXT_PUBLIC_SITE_URL + /auth/callback` 으로 돌아오도록 요청하므로,
Supabase가 그 주소를 허용 목록에 갖고 있어야 합니다.

### 클릭 경로

1. https://supabase.com/dashboard/project/jbfxkcjeoqwcdsxuemug/auth/url-configuration 접속
   - 직접 가려면: https://supabase.com/dashboard → 프로젝트 **`freesign`** 클릭 →
     왼쪽 사이드바 **Authentication**(사람 아이콘) → 그 안의 **URL Configuration**

2. **Site URL** 칸을 `https://maedeup.app` 으로 교체 → **Save**

3. **Redirect URLs** 섹션에서 **`Add URL`** 클릭 → 아래를 **하나씩 추가**:
   ```
   https://maedeup.app/**
   https://www.maedeup.app/**
   ```

4. 🔴 **기존 항목은 지우지 마세요.** 아래가 남아 있어야 합니다:
   ```
   https://freesign.vercel.app/**     ← 구 도메인, 전환 기간 동안 필요
   http://localhost:3000/**           ← 로컬 개발
   ```

5. **Save** 클릭

---

# 5. Google Cloud Console — OAuth 동의 화면

로그인 시 사용자에게 보이는 **앱 이름과 로고**입니다. 아직 `FreeSign`으로 뜹니다.

> Google이 최근 이 메뉴를 **"Google Auth Platform"** 으로 개편했습니다.
> 예전 UI면 **APIs & Services → OAuth consent screen**, 새 UI면 아래 경로입니다.

### 5-1. 앱 이름·로고 (Branding)

1. https://console.cloud.google.com/auth/branding 접속
2. 화면 위쪽에서 **프로젝트가 맞는지 확인** (드롭다운에서 이 앱의 GCP 프로젝트 선택)
3. **`Edit App`** 클릭
4. 수정할 항목:
   - **App name**: `FreeSign` → **`매듭`**
   - **App logo**: **Browse** → `~/freesign/public/brand/symbol.png` 업로드
     (421×421 정사각형 PNG — Google 요건 충족)
   - **Application home page**: `https://maedeup.app`
   - **Application privacy policy link**: `https://maedeup.app/legal/privacy`
   - **Application terms of service link**: `https://maedeup.app/legal/terms`
5. **Authorized domains** 섹션에서 **`+ Add domain`** → `maedeup.app` 추가
   (기존 항목은 유지)
6. 아래로 스크롤해 **Save** 클릭

> 로고를 새로 올리면 Google 재심사가 걸릴 수 있습니다. 심사 중에도 기존 로그인은
> 계속 동작하니 서비스가 멈추지는 않습니다.

### 5-2. OAuth 클라이언트 (대부분 그대로)

1. https://console.cloud.google.com/auth/clients 접속
   (예전 UI: **APIs & Services → Credentials → OAuth 2.0 Client IDs**)
2. 사용 중인 **Web application** 클라이언트 클릭
3. **Authorized redirect URIs** — **변경 불필요**.
   여기 들어 있는 값은 Supabase 콜백입니다:
   ```
   https://jbfxkcjeoqwcdsxuemug.supabase.co/auth/v1/callback
   ```
   Supabase 프로젝트 ref는 안 바뀌므로 그대로 두세요. **지우지 마세요.**
4. **Authorized JavaScript origins** 에만 추가:
   ```
   https://maedeup.app
   ```
   (기존 항목 유지)
5. **Save**

---

# 6. Polar — Webhook URL

현재 **sandbox** 환경입니다.

### 클릭 경로

1. https://sandbox.polar.sh 접속 → 로그인
   (프로덕션이면 https://polar.sh)
2. 왼쪽 사이드바 맨 아래 **Settings** → **Webhooks** 탭
3. 기존 엔드포인트(`https://freesign.vercel.app/api/billing/webhook`) 행 클릭
4. 🔴 **`Delete` 후 새로 만들지 마세요. 기존 항목을 `Edit`(수정)하세요.**
   URL만 아래로 교체:
   ```
   https://maedeup.app/api/billing/webhook
   ```
5. **Save**

### 새로 만들었다면 — 반드시 두 곳을 갱신

엔드포인트를 새로 만들면 **서명 시크릿이 재발급**됩니다. 한 곳이라도 빠뜨리면
webhook이 전량 `unauthorized`로 거부되고 **결제한 사용자가 조용히 Free에 남습니다.**

**(a) Vercel**
```bash
cd ~/freesign
vercel env rm POLAR_WEBHOOK_SECRET production
vercel env add POLAR_WEBHOOK_SECRET production     # 값: Polar가 준 새 whsec_...
```

**(b) DB** — https://supabase.com/dashboard/project/jbfxkcjeoqwcdsxuemug/sql/new
```sql
select set_billing_webhook_secret('<위와 동일한 whsec_... 값>');
```
> 원격 `billing_config`는 아직 **로컬 sandbox 시크릿의 해시**를 들고 있습니다.
> 이 SQL을 빼먹는 것이 가장 흔한 사고 지점입니다. (`docs/SECURITY_NEXT_STEPS.md` 4절)

6. 상품·조직 표시명의 `FreeSign` → `매듭` 도 함께 수정
7. 프로덕션 전환은 별건 — `docs/BILLING_PLAN.md` 체크리스트 참고

---

# 7. PostHog — 프로젝트명 (선택, 안 해도 무방)

1. https://us.posthog.com/project/514785/settings/project 접속
2. **Project name** 을 `매듭` 으로 → 저장

기능에는 영향 없습니다. 이벤트 이름은 그대로 두세요(과거 데이터와 연결이 끊깁니다).

---

# 8. 맨 마지막 — 기존 링크가 다 만료된 뒤에

> 🔴 **지금 하지 마세요.** `*.vercel.app` 주소는 **프로젝트 이름에서 자동 생성**됩니다.
> 프로젝트를 개명하는 순간 `freesign.vercel.app`이 **사라지고**, 이미 발송된
> 서명·청구서 링크가 전부 죽습니다. 서명 토큰 만료 기간이 지난 뒤(최소 수 주 후)에.

- [ ] **Vercel 프로젝트명**
      https://vercel.com/hanminseoks-projects/freesign/settings →
      **Project Name** 을 `maedeup` 으로 → Save
- [ ] **GitHub 레포명**
      ```bash
      gh repo rename maedeup --repo minseokhan/freesign
      cd ~/freesign && git remote set-url origin https://github.com/minseokhan/maedeup.git
      ```
- [ ] **Supabase 프로젝트명** — Settings → General → Project name.
      **project ref는 안 바뀌므로 안전**합니다(연결 정보 그대로).
- [ ] **로컬 디렉터리**
      ```bash
      cd ~ && mv freesign maedeup
      ```
      Claude Code 메모리 경로(`~/.claude/projects/-Users-hanms-freesign`)도 함께 옮겨야 합니다.
- [ ] `scripts/lighthouse-loop/measure.mjs` 의 `VERCEL_URL` 을 `https://maedeup.app` 으로
      (DNS만 끝나면 지금 바꿔도 됩니다)

---

## 남은 리스크

| 항목 | 내용 |
|---|---|
| 이미 발송된 서명·청구서 링크 | `freesign.vercel.app` 기준. **8번 전까지는 정상 동작** |
| 이미 생성된 PDF | 안에 박힌 URL은 구 도메인. 재생성 전까지 그대로 |
| 완결증명서 | 발행처가 "매듭"으로 바뀜. 이전 발행분은 "FreeSign" — 발행 시점 기록이라 정상 |
| 검색엔진 | 새 도메인 인덱싱에 시간 필요. Search Console에 `maedeup.app` 등록 권장 |
| 코드의 구 도메인 allowlist | **없음.** `csp.ts`·`safe-redirect.ts`는 상대경로 기반이라 지울 것이 없음 |

# 매듭 리브랜딩 — 사람이 직접 해야 하는 작업

> 코드·문서·컬러·로고는 전부 자동 처리했다. 이 문서는 **외부 콘솔 로그인이 필요해
> 에이전트가 대신할 수 없는 항목**만 모았다. 위에서 아래로 순서대로 하면 된다.
> 전체 맥락은 `docs/REBRAND_PLAN.md`.

작성일: 2026-08-03

---

## ⚠️ 순서가 중요한 이유

`freesign.vercel.app`으로 이미 발급된 **서명 링크·청구서 공개 링크**가 살아 있다.
그래서 원칙은:

1. 새 도메인이 **먼저 뜨게** 만든다 (DNS → 인증)
2. 그 다음에 `NEXT_PUBLIC_SITE_URL`을 새 도메인으로 바꾼다 → **이후 발급되는** 링크만 새 도메인
3. 구 도메인 `freesign.vercel.app`은 **지우지 않는다.** 기존 링크가 다 만료될 때까지 그대로 둔다.

`NEXT_PUBLIC_SITE_URL`을 DNS보다 먼저 바꾸면 **그 사이에 발급된 링크가 죽는다.** 순서를 지킬 것.

---

## ✅ 이미 끝난 것 (확인만 하면 됨)

- [x] Vercel 프로젝트 `freesign`에 `maedeup.app` · `www.maedeup.app` 도메인 **추가 완료**
      (Vercel CLI로 처리. 아래 1번 DNS만 하면 인증이 자동으로 통과된다)
- [x] 코드·문서 전체 브랜드 문자열 교체, 컬러 남색 전환, 로고·파비콘 교체

---

## 1. Cloudflare — DNS 레코드 추가 🔴 최우선

Cloudflare 대시보드 → `maedeup.app` → **DNS → Records**

| Type | Name | Content | Proxy status |
|---|---|---|---|
| A | `@` | `76.76.21.21` | **DNS only (회색 구름)** |
| CNAME | `www` | `cname.vercel-dns.com` | **DNS only (회색 구름)** |

> 🔴 **Proxy를 반드시 끄세요(회색 구름).** 주황색 구름(프록시 ON)이면 Vercel의 SSL 인증서
> 발급이 실패하거나 리다이렉트 루프가 생깁니다.

**확인:** 몇 분 뒤 아래 명령이 `Configuration is valid`로 바뀌면 성공.
```bash
cd ~/freesign && vercel domains inspect maedeup.app
```
또는 브라우저에서 https://maedeup.app 접속 → 지금 사이트가 뜨면 완료.

---

## 2. Resend — 발신 도메인 인증

이제 앱 도메인과 발신 도메인이 일치한다(스팸 점수에 유리).
상세 런북: `docs/EMAIL_DOMAIN_SETUP.md`

1. https://resend.com/domains → **Add Domain** → `maedeup.app` 입력
2. Resend가 보여주는 레코드 3종을 **Cloudflare DNS에 추가** (전부 **DNS only**).
   Cloudflare는 Name에 짧은 이름만 넣으면 자동으로 도메인을 붙인다 —
   **FQDN을 그대로 넣으면 `send.maedeup.app.maedeup.app`이 되니 주의**:

   | 종류 | Name (Cloudflare에 넣을 값) | 값 |
   |---|---|---|
   | MX | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey` | Resend 화면의 긴 공개키 그대로 |
   | TXT (권장) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<본인주소>` |

3. Resend에서 **Verify** → 상태 `Verified` 확인

> 정확한 값은 **반드시 Resend 대시보드 화면의 것**을 쓰세요 (DKIM 공개키와 MX의 리전 문자열이
> 계정마다 다릅니다). 상세 설명은 `docs/EMAIL_DOMAIN_SETUP.md`.

**참고:** 지금은 `EMAIL_FROM`이 비어 있어 Resend 테스트 주소(`onboarding@resend.dev`)로
발송되며, **본인 계정 주소로만 수신됩니다.** 클라이언트에게 실제로 메일이 가려면
이 단계가 반드시 필요합니다.

---

## 3. Vercel — 환경 변수 갱신 (1·2번 완료 후에)

프로젝트: `hanminseoks-projects/freesign`

```bash
cd ~/freesign

# 앱 URL을 새 도메인으로 (기존 값 삭제 후 재등록)
vercel env rm NEXT_PUBLIC_SITE_URL production
vercel env add NEXT_PUBLIC_SITE_URL production
#   → 값 입력: https://maedeup.app

# 발신 주소 신규 등록 (Resend 인증 완료 후에만!)
vercel env add EMAIL_FROM production
#   → 값 입력: 매듭 <no-reply@maedeup.app>

# 반영하려면 재배포 필요
vercel --prod
```

> 현재 프로덕션에 `EMAIL_FROM`은 **등록되어 있지 않다**(테스트 주소 폴백 중).
> `POLAR_*` 변수들도 프로덕션에 없다 — 결제를 프로덕션으로 올릴 때 별도 처리 필요.

---

## 4. Supabase — Auth Redirect URL

프로젝트: `freesign` (`jbfxkcjeoqwcdsxuemug`)
Dashboard → **Authentication → URL Configuration**

- **Site URL**: `https://maedeup.app`
- **Redirect URLs**에 아래를 **추가** (기존 항목은 지우지 말 것):
  ```
  https://maedeup.app/**
  https://www.maedeup.app/**
  ```
  → 기존 `https://freesign.vercel.app/**`, `http://localhost:3000/**`은 **유지**

> 이걸 안 하면 새 도메인에서 Google 로그인 후 리다이렉트가 차단된다.

---

## 5. Google Cloud Console — OAuth 동의 화면 / 승인된 도메인

https://console.cloud.google.com → APIs & Services

**OAuth consent screen:**
- 앱 이름: `FreeSign` → **`매듭`**
- 앱 로고: `public/brand/symbol.png` 업로드 (레포에 있음)
- 승인된 도메인(Authorized domains)에 `maedeup.app` **추가**
- 홈페이지 / 개인정보처리방침 / 이용약관 URL:
  - `https://maedeup.app`
  - `https://maedeup.app/legal/privacy`
  - `https://maedeup.app/legal/terms`

**Credentials → OAuth 2.0 Client ID:**
- 승인된 리디렉션 URI는 Supabase 콜백(`https://jbfxkcjeoqwcdsxuemug.supabase.co/auth/v1/callback`)
  그대로이므로 **변경 불필요**
- 승인된 JavaScript 원본에 `https://maedeup.app` **추가**(기존 항목 유지)

---

## 6. Polar — Webhook URL / 브랜딩

https://polar.sh 대시보드 (현재 **sandbox** 환경)

- Settings → Webhooks: 엔드포인트를
  `https://freesign.vercel.app/api/billing/webhook` → `https://maedeup.app/api/billing/webhook`
  로 변경
  > ⚠️ 엔드포인트를 새로 만들면 **서명 시크릿이 새로 발급된다.** 새 시크릿을 받으면
  > Vercel `POLAR_WEBHOOK_SECRET`과 **DB `billing_config` 테이블 둘 다** 갱신해야 한다
  > (`docs/BILLING_PLAN.md` 참조). 기존 엔드포인트를 **수정**하면 시크릿이 유지된다 — 수정 권장.
- 상품/조직 표시명의 `FreeSign` → `매듭`
- 프로덕션 전환은 별건 — `docs/BILLING_PLAN.md`의 프로덕션 체크리스트 참고

---

## 7. PostHog — 프로젝트명 (선택)

organization `freesign` / project `Default project`.
기능에는 영향 없음. 원하면 Settings에서 표시명만 `매듭`으로.

---

## 8. 맨 마지막 — 기존 링크가 다 만료된 뒤에

> 🔴 **지금 하지 마세요.** 서명·청구서 링크가 살아 있는 동안 이름을 바꾸면
> `freesign.vercel.app`이 사라져 기존 링크가 전부 죽습니다.
> 서명 요청 토큰 만료 기간이 지난 뒤(최소 수 주 후) 진행하세요.

- [ ] Vercel 프로젝트명 `freesign` → `maedeup` (Settings → General → Project Name)
      → `freesign.vercel.app`이 **사라진다**. 이게 이 단계의 핵심 리스크.
- [ ] GitHub 레포명 변경:
      ```bash
      gh repo rename maedeup --repo minseokhan/freesign
      cd ~/freesign && git remote set-url origin https://github.com/minseokhan/maedeup.git
      ```
- [ ] Supabase 프로젝트명 `freesign` → `maedeup` (Settings → General. **project ref는 안 바뀜** — 안전)
- [ ] 로컬 디렉터리 `~/freesign` → `~/maedeup`
      ```bash
      cd ~ && mv freesign maedeup
      ```
      → Claude Code 메모리 경로(`~/.claude/projects/-Users-hanms-freesign`)도 함께 옮겨야 함
> 참고: `src/lib/csp.ts`·`safe-redirect.ts`에는 도메인이 하드코딩돼 있지 않다(상대경로 기반).
> 코드에서 지울 구 도메인 allowlist는 **없다.**

---

## 남은 리스크 / 확인 필요

| 항목 | 내용 |
|---|---|
| 이미 발송된 서명 링크 | `freesign.vercel.app` 기준. 8번 전까지는 정상 동작 |
| PDF에 박힌 URL | 이미 생성된 계약·인보이스 PDF의 URL은 구 도메인. 재생성 전까지 그대로 |
| 완결증명서 | 발행처 표기가 "매듭"으로 바뀜. 이전 발행분은 "FreeSign" — 정상(발행 시점 기록) |
| 검색엔진 | 새 도메인 인덱싱까지 시간 필요. Search Console에 `maedeup.app` 등록 권장 |

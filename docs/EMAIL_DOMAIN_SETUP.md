# 발신 도메인 인증 (Resend)

**목적:** 청구서·서명 요청·독촉 메일이 **제3자(클라이언트) 메일함으로 실제 도달**하게 만들고,
그 결과로 `invoice.sent` 이벤트("청구한 날의 증거")가 실제로 쌓이게 한다.

**현재 상태(2026-08-03):** 프로덕션에 `RESEND_API_KEY`는 있으나 `EMAIL_FROM`이 미설정이라
발신자가 `FreeSign <onboarding@resend.dev>`로 폴백된다(`src/services/email/provider.ts`).
Resend의 이 공용 테스트 도메인은 **계정 본인 주소로만** 발송이 허용되므로, 클라이언트 발송은
403으로 실패하고 화면에는 "전달되지 않음 — 링크를 직접 전해 주세요"가 뜬다.
링크 발급·열람 기록은 정상 동작한다. 막힌 것은 **메일 도달**뿐이다.

---

## 0. 선행 조건 — 도메인이 필요하다

Resend 도메인 인증은 해당 도메인의 **DNS 존에 DKIM/SPF 레코드를 추가**하는 방식이다.
현재 Vercel 프로젝트에는 커스텀 도메인이 없고 `*.vercel.app`뿐인데, `vercel.app`은 Vercel 소유라
레코드를 넣을 수 없다. **`freesign.vercel.app`으로는 인증이 불가능하다.**

→ 도메인을 하나 확보한다(예: `freesign.kr`, `freesign.app`). 등록 기관은 무관하며
DNS 레코드를 직접 편집할 수 있으면 된다(Cloudflare·가비아·Namecheap·Vercel Domains 등).

이미 보유한 다른 도메인이 있다면 그 서브도메인(`mail.보유도메인.com`)으로도 가능하다.
서브도메인 인증은 루트 도메인의 메일 평판과 분리된다는 장점이 있다.

---

## 1. Resend에 도메인 등록

1. Resend 대시보드 → **Domains** → **Add Domain**
2. 도메인 입력, Region 선택(기본값으로 두어도 무방 — 아래 MX 레코드 값이 리전에 따라 달라진다)
3. 화면에 뜨는 DNS 레코드 목록을 그대로 복사한다

레코드는 보통 아래 3종이다. **정확한 값은 반드시 대시보드 화면 것을 쓴다**
(특히 DKIM 공개키와 MX 호스트의 리전 문자열).

| 종류 | 이름(Host) | 값 |
| --- | --- | --- |
| MX | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSq...` (대시보드 값) |

## 2. DNS에 레코드 추가

등록 기관/DNS 제공자 콘솔에서 위 레코드를 추가한다.

- **Cloudflare를 쓴다면 이 레코드들의 프록시(주황 구름)를 반드시 끈다** (DNS only).
  프록시가 켜져 있으면 검증이 통과하지 않는다.
- 이름 입력 시 제공자에 따라 `send` / `send.도메인.com` 중 하나를 요구한다. 콘솔의 예시를 따른다.
- 이미 다른 SPF TXT가 루트에 있어도 무방하다. Resend는 `send` 서브도메인을 Return-Path로 쓴다.

### DMARC (권장)

수신함 도달률을 위해 루트에 하나 더 추가한다. 처음에는 관측 전용(`p=none`)으로 시작한다.

| 종류 | 이름 | 값 |
| --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<본인주소>` |

## 3. 검증

Resend 대시보드에서 **Verify**. 전파에 보통 수 분~수 시간이 걸린다.
상태가 `Verified`가 될 때까지 다음 단계로 넘어가지 않는다.

---

## 4. `EMAIL_FROM` 설정

인증된 도메인의 주소로 설정한다. 인증하지 않은 도메인을 넣으면 403으로 전량 실패한다.

```
EMAIL_FROM=FreeSign <no-reply@<인증한도메인>>
```

- **로컬:** `.env.local`
- **프로덕션:** Vercel → freesign 프로젝트 → Settings → Environment Variables → Production
  → 추가 후 **재배포해야 반영된다**(빌드 타임이 아니라 런타임 값이지만 새 배포에서 주입된다).

## 5. 도달 확인

1. 프로덕션에서 클라이언트 `contact_email`이 **본인이 아닌 주소**인 인보이스를 하나 발송한다.
2. 화면이 "전달되지 않음"이 아닌 정상 발송 문구로 바뀌는지 확인한다
   (`src/app/(dashboard)/invoices/[id]/page.tsx`).
3. 해당 인보이스의 이벤트 로그에 **`invoice.sent`가 남았는지** 확인한다 — 이것이 이 작업의 성공 기준이다.
   ```sql
   select event_type, created_at, meta
     from invoice_events
    where invoice_id = '<id>'
    order by created_at desc;
   ```
4. 실패한다면 Vercel 런타임 로그에서 `[invoice] 청구 안내 이메일 발송 실패:` 를 찾는다.
   Resend가 준 사유가 함께 찍힌다(예: `status 403: The ... domain is not verified.`).

---

## 남는 이슈

- **앱 URL과 발신 도메인 불일치.** 메일은 `no-reply@freesign.kr`에서 오는데 본문 링크는
  `freesign.vercel.app`이면 수신자에게 피싱처럼 보이고 스팸 판정에도 불리하다.
  도메인을 샀다면 Vercel 커스텀 도메인으로도 연결하고 `NEXT_PUBLIC_SITE_URL`을 함께 옮기는 것을 권한다.
- **회신 주소.** 실제 발신자는 프리랜서 본인인데 메일은 FreeSign 도메인에서 나간다. 클라이언트가
  "회신"을 누르면 아무 데도 가지 않는다. Resend `reply_to`에 사용자 이메일을 넣는 것이 자연스러운
  후속 작업이다(별도 판단 필요 — 사용자 이메일을 제3자에게 노출하는 결정이므로).
- **발송 한도.** Resend 무료 플랜은 일/월 발송 상한이 있다. 실제 상한은 대시보드에서 확인한다.

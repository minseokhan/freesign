# 발신 도메인 인증 (Resend)

**목적:** 청구서·서명 요청·독촉 메일이 **제3자(클라이언트) 메일함으로 실제 도달**하게 만들고,
그 결과로 `invoice.sent` 이벤트("청구한 날의 증거")가 실제로 쌓이게 한다.

**현재 상태(2026-08-04):** 도메인 인증과 `EMAIL_FROM` 설정이 **완료**됐다.
프로덕션 env에 `RESEND_API_KEY`·`EMAIL_FROM`이 모두 있고, DNS에 Resend 3종
(`send` MX/SPF, `resend._domainkey` DKIM)이 확인된다. 아래 1~4절은 **완료된 절차의 기록**이고,
남은 것은 5절의 **실제 도달 확인**뿐이다.

`EMAIL_FROM`을 지우면 발신자가 `매듭 <onboarding@resend.dev>`로 폴백되는데, 이 공용 테스트
도메인은 **계정 본인 주소로만** 발송이 허용되므로 클라이언트 발송이 403으로 실패한다
(`src/services/email/provider.ts`). 그 경우에도 링크 발급·열람 기록은 정상 동작한다 —
막히는 것은 **메일 도달**뿐이다.

**인증 대상 도메인:** `maedeup.app` (Cloudflare에서 구매·DNS 관리)
**최종 목표값:** `EMAIL_FROM=매듭 <no-reply@maedeup.app>`

---

## 0. 선행 조건 — 도메인 (확보 완료)

Resend 도메인 인증은 해당 도메인의 **DNS 존에 DKIM/SPF 레코드를 추가**하는 방식이다.
`*.vercel.app`은 Vercel 소유라 레코드를 넣을 수 없으므로 **자체 도메인이 반드시 필요**하다.

`maedeup.app`을 Cloudflare에서 구매했으므로 이 조건은 충족됐다. 아래 작업은 모두
**Cloudflare 대시보드 → `maedeup.app` → DNS → Records** 에서 한다.

> 루트(`maedeup.app`)를 그대로 발신 도메인으로 쓴다. 서브도메인(`mail.maedeup.app`)으로
> 분리하면 루트의 메일 평판과 격리되는 장점이 있지만, 앱 URL(`https://maedeup.app`)과
> 발신 주소의 도메인을 일치시키는 편이 수신자 신뢰·스팸 판정에 유리하다.

---

## 1. Resend에 도메인 등록

1. Resend 대시보드 → **Domains** → **Add Domain**
2. 도메인에 `maedeup.app` 입력, Region 선택(기본값으로 두어도 무방 — 아래 MX 레코드 값이 리전에 따라 달라진다)
3. 화면에 뜨는 DNS 레코드 목록을 그대로 복사한다

레코드는 보통 아래 3종이다. **정확한 값은 반드시 대시보드 화면 것을 쓴다**
(특히 DKIM 공개키와 MX 호스트의 리전 문자열).

| 종류 | 이름(Host) | 값 |
| --- | --- | --- |
| MX | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSq...` (대시보드 값) |

## 2. Cloudflare DNS에 레코드 추가

**Cloudflare 대시보드 → `maedeup.app` → DNS → Records → Add record** 로 위 3건을 추가한다.

- **프록시 상태(주황 구름)를 반드시 끈다 — `DNS only`(회색 구름).**
  MX·TXT는 원래 프록시 대상이 아니지만, 실수로 켜면 검증이 통과하지 않는다.
- Cloudflare는 Name에 `send`만 넣으면 자동으로 `send.maedeup.app`으로 확장한다.
  Resend 화면이 FQDN(`send.maedeup.app`)을 보여줘도 Cloudflare에는 `send`만 넣는다
  (`send.maedeup.app`을 그대로 넣으면 `send.maedeup.app.maedeup.app`이 된다).
- 이미 다른 SPF TXT가 루트에 있어도 무방하다. Resend는 `send` 서브도메인을 Return-Path로 쓴다.
- 나중에 Vercel 커스텀 도메인을 붙일 때 추가하는 A/CNAME 레코드와는 서로 간섭하지 않는다.

### DMARC (권장)

수신함 도달률을 위해 루트에 하나 더 추가한다. 처음에는 관측 전용(`p=none`)으로 시작한다.

| 종류 | 이름 | 값 |
| --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<본인주소>` |

Cloudflare에서는 Name에 `_dmarc`만 넣는다(`_dmarc.maedeup.app`으로 확장된다).

## 3. 검증

Resend 대시보드에서 **Verify**. 전파에 보통 수 분~수 시간이 걸린다.
상태가 `Verified`가 될 때까지 다음 단계로 넘어가지 않는다.

---

## 4. `EMAIL_FROM` 설정

인증된 도메인의 주소로 설정한다. 인증하지 않은 도메인을 넣으면 403으로 전량 실패한다.
`maedeup.app`이 `Verified`가 된 뒤에 넣는다.

```
EMAIL_FROM=매듭 <no-reply@maedeup.app>
```

- **로컬:** `.env.local`
- **프로덕션:** Vercel → 프로젝트(현재 이름 `freesign`, 리브랜딩 마지막 단계에서 `maedeup`으로 개명 예정)
  → Settings → Environment Variables → Production
  → 추가 후 **재배포해야 반영된다**(빌드 타임이 아니라 런타임 값이지만 새 배포에서 주입된다).
- `no-reply@maedeup.app` 메일함을 실제로 만들 필요는 없다. Resend는 인증된 도메인의
  **아무 로컬파트로든 발신**할 수 있다. 다만 이 주소로 오는 회신은 아무 데도 가지 않는다(아래 "남는 이슈").

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

- **앱 URL과 발신 도메인 일치시키기.** 메일은 `no-reply@maedeup.app`에서 오는데 본문 링크가
  `freesign.vercel.app`이면 수신자에게 피싱처럼 보이고 스팸 판정에도 불리하다.
  **2026-08-04 해결됨** — Cloudflare DNS·커스텀 도메인 연결·`NEXT_PUBLIC_SITE_URL` 교체가
  모두 끝나 앱 URL과 발신 도메인이 `maedeup.app`으로 일치한다.
- **회신 주소.** 실제 발신자는 프리랜서 본인인데 메일은 매듭 도메인에서 나간다. 클라이언트가
  `no-reply@maedeup.app`으로 "회신"을 누르면 아무 데도 가지 않는다(수신은 Cloudflare Email
  Routing이 `support@maedeup.app` 하나만 Gmail로 포워딩한다). Resend `reply_to`에 사용자 이메일을 넣는 것이 자연스러운
  후속 작업이다(별도 판단 필요 — 사용자 이메일을 제3자에게 노출하는 결정이므로).
- **발송 한도.** Resend 무료 플랜은 일/월 발송 상한이 있다. 실제 상한은 대시보드에서 확인한다.

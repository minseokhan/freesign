# 제품 피드백 백로그 (7개 항목 추적)

작성: 2026-08-06 · 근거: 2026-08-03 세션에서 나온 제품 리뷰 7개 항목
이 문서는 **그 7개 항목의 현재 상태를 코드 근거와 함께 박제한 추적표**다.
개별 항목의 실행 계획은 각자의 `*_PLAN.md`에, 확정된 결정은 `ADR.md`에 있다.

> 상태 표기: ✅ 완료 · 🟡 부분 · ❌ 미착수
> 새 세션은 **§3 권장 순서**에서 하나 고르고 해당 §2 절만 읽으면 바로 이어받을 수 있다.

---

## 1. 전체 현황

| #   | 항목                    | 상태 | 정본 문서                    | ADR     |
| --- | ----------------------- | ---- | ---------------------------- | ------- |
| 1   | 인보이스 발송 경로      | ✅   | `docs/INVOICE_DELIVERY_PLAN.md` | ADR-013 |
| 2   | 법적 페이지 + 계정 삭제 | ✅   | `docs/LEGAL_ACCOUNT_PLAN.md`    | ADR-012 |
| 3   | 입금 확인 보조          | ❌   | 없음                         | 없음    |
| 4   | 모바일 리스트 레이아웃  | ❌   | 없음                         | 없음    |
| 5   | 테스트 커버리지 비대칭  | ✅   | 이 문서 §2.1                 | 없음    |
| 6   | 세금 도메인 확장 결정   | ❌   | 없음                         | 없음    |
| 7   | 문서 부채(완료 PLAN)    | ❌   | 이 문서 §2.5                 | 없음    |

### 1-1. 완료 항목 (재작업 금지 — 근거)

**1번 인보이스 발송 경로 — ✅ 완료** (커밋 `168d97d`, 버그수정 `5c40dab`)

- `src/app/(public)/invoice/[token]/page.tsx` — 공개 청구서 뷰(금액·입금 계좌·PDF)
- `publishDraftInvoice()`를 남기지 않고 **`sendInvoice()`로 대체**(`src/app/(dashboard)/invoices/actions.ts:235`).
  ADR-013 3항: "발행만 하는 경로를 남기면 앱에서 발행하고 청구는 카톡으로 하는 구멍이 그대로 남는다."
- 마이그레이션 `0046_invoice_share_tokens` — **원격 적용 확인됨**(2026-08-06 `list_migrations`)

**2번 법적 페이지 + 계정 삭제 — ✅ 완료** (커밋 `dd22bcf`)

- `legal/privacy`·`terms`·`refund` 3장 + 각 렌더 테스트, 데이터 내보내기, `delete_own_account()`(인자 없는 DEFINER, ADR-012)
- 마이그레이션 `0047_account_delete_cascade`·`0048_account_deletion` — **원격 적용 확인됨**
  (`LEGAL_ACCOUNT_PLAN.md`에는 "원격 적용만 잔여"로 적혀 있으나 문서가 뒤처진 것이다)
- ⚠️ **남은 것 하나**: `src/lib/legal.ts`의 사업자 정보·지원 이메일·서비스 시행일이 아직 placeholder다.
  결제를 켜기 전 반드시 채워야 하고, 채워지지 않은 상태는 `legal.test.ts`가 감지한다.

---

## 2. 항목별 상세

### 2.1 [5번] 테스트 커버리지 비대칭 — ✅ 완료 (2026-08-06)

**이전에 이미 된 것**

- 비로그인 상대방 서명 완결 E2E — `e2e/happy-path.spec.ts`가 별도 브라우저 컨텍스트로
  `/sign/[token]`까지 완주한다 (커밋 `5cd4796`)
- 법적 페이지 3장 렌더 테스트, `login`·`billing` 페이지 테스트

**이번에 메운 것 (테스트 924 → 946)**

1. **대시보드 RSC 페이지 테스트** — `src/app/(dashboard)/dashboard/__tests__/page.test.tsx` (7)
   무테스트 구간은 "집계 쿼리 결과 → 화면" 접합이었다. `lib/metrics.ts` 순수함수는 커버돼 있었지만
   접합은 안 걸렸다.
   - pg `numeric`이 문자열로 와도 원화로 표시되는가 (`toAmount`, `page.tsx:81`)
   - 집계가 0이면 지표 대신 빈 상태로 갈리는가 (`hasDashboardData`)
   - 미입금 중 **지연·임박만** 남고 여유분은 빠지는가 (`deriveDueStatus` 접합)
   - RPC·쿼리 에러를 삼키지 않고 throw 하는가
   - free 플랜에만 업그레이드 카드가 뜨는가

   > 변이 테스트로 확인함: `toAmount`의 문자열 변환을 없애면 4개, 임박·지연 필터를 없애면
   > 2개가 즉시 빨개진다. 통과만 하는 테스트가 아니다.

2. **리포트 RSC 페이지 테스트** — `src/app/(dashboard)/reports/__tests__/page.test.tsx` (9)
   - `?year=`가 네 개 RPC 인자로 전달되고, 범위 밖·비정수는 KST 올해로 폴백 (`parseYear`)
   - free는 `Excel 내보내기 (Pro)` → 체크아웃 / pro는 `/api/reports?year=` 링크
   - **free에게는 `contract_insights` 조회 자체를 하지 않는가** (Pro 게이트가 화면 가리기로
     끝나지 않는지)
   - RPC 에러 throw

3. **결제 웹훅 E2E** — 두 층으로 나눴다. 기존 `route.test.ts`(어댑터·핸들러 둘 다 mock, 배선만 확인)는
   그대로 두고 그 아래를 메웠다.
   - **(a) 서명 → 라우트 → RPC 인자** — `src/app/api/billing/webhook/__tests__/webhook-e2e.test.ts` (6)
     `standardwebhooks`로 실제 서명한 페이로드를 POST하고, Polar SDK zod 스키마를 통과한
     **진짜 payload 모양**이 `p_user_id = customer.external_id`로 흘러가는지 본다.
     틀린 서명 → 403·RPC 미호출, revoked → 즉시 free 강등, external_id 없음 → 조용한 no-op,
     RPC 실패 → throw(Polar 재시도 유도).
     → Polar가 필드명을 바꾸면 현재 코드는 `console.error` 후 **조용히 return** 한다
       (`billing-webhook.ts:35`). 결제한 사용자가 Free로 남는 무증상 실패라 이게 유일한 감지 수단이다.
   - **(b) RPC → DB 상태** — `src/test/__tests__/billing-webhook-rpc.test.ts` (7)
     임베디드 pg에서 **anon 롤로** `upsert_subscription_from_polar` 호출 → `subscriptions` 행 +
     **`billing_events` append**(그동안 어디서도 검증 안 됐다) + revoked 강등 시 이전 이벤트 보존 +
     재전송 멱등 + `free|pro` 밖 플랜 거부 + anon 직접 INSERT 차단.

**작업 중 알게 된 것 (다음 세션 주의)**

- `@polar-sh/nextjs`를 mock 없이 태우려면 `vitest.config.ts`에 `server.deps.inline`이 필요하다.
  외부 모듈로 두면 node가 `next/server` 서브패스를 못 찾는다.
- Polar 페이로드 픽스처는 `src/test/fixtures/polar-subscription.ts`에 모았다.
  **SDK zod 스키마 전체를 통과하는 형태**여야 한다(요약본은 라우트가 검증 단계에서 던진다).
  → 이 픽스처 자체가 "우리가 가정하는 Polar 페이로드 모양"의 회귀 테스트다.
- `billing_config`는 단일 행 전역 상태다. `secret-hash-storage.test.ts`와 **같은 시크릿 값**을 쓴다
  (테스트 파일은 병렬로 돈다 — 값을 바꾸면 상대 파일이 깨진다). 해당 파일 주석도 같이 고쳤다.

**대상에서 뺀 것**: `contracts`·`invoices`·`clients` 리스트 페이지 테스트. 접합 복잡도가 낮고
(단순 목록 렌더) E2E가 이미 지나간다. 필요해지면 같은 패턴으로 추가하면 된다.

**검증 결과**: `npm test` 946개 그린 · `npm run lint` 그린 · `npm run build:verify` 그린.

---

### 2.2 [3번] 입금 확인 보조 — ❌ 미착수

**현재 상태 (2026-08-06 확인)**

- 크론은 `runDunningSweep`·`runRecurringSweep` **2개뿐**(`src/app/api/cron/daily/route.ts:53`).
  지급기한 임박 소유자 알림 스윕은 없다.
- 대시보드에 "임박" 배지는 있지만(`dashboard/page.tsx:106`) **앱을 열어야만 보인다**. 밀어주는 알림이 없다.
- 공개 청구서 페이지에 입금 계좌는 표시되지만(`(public)/invoice/[token]/page.tsx:167`)
  클라이언트가 "입금했다"고 알릴 경로가 없다.

**할 일 (싼 것부터)**

1. D-day 소유자 알림 스윕 — 크론·메일 인프라가 이미 있어 스윕 하나 추가면 된다.
   ADR-011 원칙 유지: 크론은 클라이언트에게 직접 발송하지 않는다. **소유자에게만** 보낸다.
2. 공개 청구서에 "입금 완료했습니다" 신고 버튼 → 소유자 확인 대기 상태.
   대조 작업이 "기억해내기"에서 "예/아니오"로 바뀐다.
   ⚠️ 설계 주의: 클라이언트 주장은 **증거가 아니다**. `payment_status`를 직접 바꾸면 안 되고
   별도 신고 필드 + 소유자 확인 전이여야 한다(ADR-006 상태 머신 유지).

오픈뱅킹 연동은 비용·심사 때문에 현 단계에서 과하다 — 위 2개가 중간 단계다.

---

### 2.3 [4번] 모바일 리스트 레이아웃 — ❌ 미착수

`invoices/page.tsx:211`·`contracts/page.tsx:217` 모두 여전히 `overflow-x-auto` + `<table>`이고
`md:hidden` 카드 분기가 없다. 폰에서 가로로 밀린다.

프리랜서가 폰을 꺼내는 순간은 대부분 "그거 입금됐나" 확인이고 그게 정확히 인보이스 리스트다.
`md` 미만에서 `<table>`을 숨기고 카드로 바꾸는 정도면 충분하다.

---

### 2.4 [6번] 세금 도메인 확장 결정 — ❌ 미착수 (코드 아님, 결정)

현재 세금 모델은 원천징수 3종(`wt_3_3`/`wt_8_8`/`none`)뿐이고 부가세·`currency`·세금계산서가 없다.
MVP 제외 항목으로 명시된 **의도적 선택**이다.

결정해야 할 것: 프리랜서가 개인사업자로 전환하면 부가세 10%·세금계산서가 필요해진다.
즉 지금 구조는 "고객이 성공하면 제품을 떠난다". 타깃을 3.3% 프리랜서로 못 박을지, 성장 경로를 열지.

- 지금 결정하면 마이그레이션 1개, 데이터가 쌓인 뒤면 훨씬 비싸다.
- **구현하란 뜻이 아니다.** ADR-014로 결정만 박으면 된다.
- 참고: ADR-010 트레이드오프 절에 "Polar는 한국 세금계산서(홈택스) 발급 미지원"이 이미 적혀 있다 —
  같은 문제의 다른 얼굴이다.

---

### 2.5 [7번] 문서 부채 — ❌ 미착수

`docs/` 아래 완료된 작업의 계획서가 **8편** 남아 있고 `docs/archive/`는 없다.

```
BILLING_PLAN.md            PRO_FEATURES_PLAN.md
SIGNATURE_V2_PLAN.md       SIGNATURE_V2_FIXES_PLAN.md
LIGHTHOUSE_LOOP_PLAN.md    SECURITY_REMEDIATION_PLAN.md
INVOICE_DELIVERY_PLAN.md   LEGAL_ACCOUNT_PLAN.md
```

하네스가 매 세션 읽는 컨텍스트 비용이고, 새로 오는 사람(또는 에이전트)이
"이게 아직 할 일인가?"를 매번 판단해야 한다.

**할 일**: `docs/archive/`로 옮기고 결론은 ADR에만 남긴다.
⚠️ 옮기기 전 확인: 각 PLAN을 참조하는 링크가 `ADR.md`·`CLAUDE.md`·`SECURITY_NEXT_STEPS.md`에 있다.
경로를 같이 고치지 않으면 깨진 참조가 된다.

---

## 3. 권장 순서 (남은 것)

1. **2.5 문서 정리** — 가장 싸고, 이후 세션의 컨텍스트 비용을 즉시 줄인다
2. **2.4 ADR-014** — 코드가 아니라 결정. 스키마가 작을 때가 싸다
3. **2.2 입금 알림** → **2.3 모바일** — 둘 다 제품 가치, 순서는 취향

그리고 **결제를 켜기 전** `src/lib/legal.ts` placeholder(사업자 정보·지원 이메일·시행일)를 채운다(§1-1).

## 4. 변경 이력

- 2026-08-06 — 문서 생성. 1·2번 완료 확인(원격 마이그레이션 0046~0048 적용 검증)
- 2026-08-06 — **5번 완료**: 대시보드·리포트 RSC 페이지 테스트 + 결제 웹훅 E2E 2층 (테스트 +22)

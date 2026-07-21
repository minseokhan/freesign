# FreeSign 결제 시스템(Polar) + Free/Pro 플랜 도입

## Context (왜)

FreeSign에 유료화를 붙인다. 현재 결제/구독/플랜 인프라는 **완전 백지**(관련 테이블·코드·env 전무). `services/payment/provider.ts`는 이름만 payment일 뿐 인보이스 입금상태 머신이라 무관.

인터뷰로 확정한 방향:
- **핵심 경계: "불러오기 = Free / 새 계약 생성·서명 = Pro".**
  - **불러온 계약**(`import_signed_contract_with_event` — 이름부터 "signed")은 이미 서명된 외부 계약을 **정리·추적**하는 것. 서명 플로우가 필요 없음 → 무료의 기록 체인 가치.
  - **새로 만든 계약**은 앱에서 **쌍방 서명 + TSA 타임스탬프 + 완결증명서**까지 도는 풀 워크플로우 → Pro.
  - 우리 서명은 애초에 쌍방 서명뿐이고, TSA·완결증명서는 그 위에 증거력을 얹는 산출물. **이 서명·TSA·증명서 플로우는 "새 계약 생성(Pro)"에만 존재**하므로 별도 게이트 없이 자동으로 Pro가 된다.
- **무료의 유일한 비용 지점 = 불러오기 AI 파싱.** 요청마다 실제 Anthropic 토큰 비용이 나가므로 **누적 총 5회**로 제한. 6회째부터, 또는 더 많은 새 계약을 만들어 서명받고 싶으면 Pro.
- **무료도 "새 계약 생성·쌍방 서명"을 1건 경험할 수 있다** — 제품의 히어로 기능(생성→서명→TSA→증명서)을 한 번 맛보게 해 activation·전환을 살린다. 2건째부터 Pro. (아하 순간이 페이월 뒤에 있는 리스크 완화.)
- **인보이스·클라이언트는 별도 상한 없음** — 불러온 계약 기준으로 청구·입금추적·거래처 관리는 무료로 온전히 제공(기록 체인 = 무료 락인).
- **AI 초안(새 계약 생성)은 무료 1건까지, 이후 Pro.** AI 파싱(불러오기)은 무료 5회.
- **세금 CSV export·고급 대시보드는 Pro** (별도 게이트 유지).
- **과금 형태: 월 정기구독 단일** (가격은 Polar 대시보드 설정).
- **Webhook 아키텍처: SECURITY DEFINER RPC** — Polar webhook은 로그인 세션이 없어 남의 구독 행을 써야 한다. `service_role`(마스터키)을 요청 경로에 두는 대신, 서명 검증 후 anon 클라이언트로 정의자권한 RPC 하나만 호출해 구독 행을 upsert. 기존 `..._with_event` RPC 컨벤션·보안 정책 유지.

## Free/Pro 매트릭스

| 기능 | Free | Pro |
|---|---|---|
| 기존 계약 불러오기 (AI 파싱) | ✅ **누적 5회까지** | 무제한 |
| 불러온 계약 정리·조회 | ✅ | ✅ |
| 인보이스 발행·입금 추적 | ✅ (상한 없음) | ✅ |
| 클라이언트(거래처) 관리 | ✅ (상한 없음) | ✅ |
| 세금 리포트 화면 조회 | ✅ | ✅ |
| **새 계약 생성 (AI 초안)** | ✅ **1건까지** | 무제한 |
| **쌍방 서명 + TSA + 완결증명서** | ✅ **1건까지**(새 계약 1건에 딸림) | 무제한 |
| **세금 리포트 CSV export** | ❌ | ✅ |
| **고급 대시보드(채널·클라이언트 매출 랭킹)** | ❌ (업셀 표시) | ✅ |

**요지**: 무료 = "이미 맺은 계약들을 불러와 청구·입금까지 정리"(5건 파싱) + "직접 계약 만들어 서명받기 1건 체험". Pro = 불러오기·새 계약·서명 모두 무제한. 업그레이드 동기는 (a) 5회 초과 불러오기, (b) 2건째 새 계약 생성·서명.

---

## 구현 계획

### 1. 데이터 모델 — 신규 마이그레이션 `supabase/migrations/0024_billing.sql`

기존 컨벤션(`0001_schema.sql`, RLS `0002`, RPC `0012`) 준수.

**`subscriptions` 테이블** (user당 1행, 없으면 free):
```
subscriptions(
  user_id uuid primary key references auth.users(id),
  plan text not null default 'free' check (plan in ('free','pro')),
  status text not null default 'inactive',
  polar_customer_id text,
  polar_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
)
```
- RLS: **SELECT는 본인 행만**(UI 렌더용). **INSERT/UPDATE는 클라이언트 직접 금지** — 아래 SECURITY DEFINER RPC로만 기록.

**`billing_events` append-only 감사 로그** (기존 `contract_events`/`invoice_events` 패턴):
```
billing_events(id, user_id, polar_subscription_id, event_type, status, meta jsonb, created_at)
```

**SECURITY DEFINER RPC `upsert_subscription_from_polar(...)`**:
- 파라미터: `p_user_id, p_polar_customer_id, p_polar_subscription_id, p_plan, p_status, p_current_period_end, p_cancel_at_period_end, p_event_type, p_meta`
- `security definer`로 RLS 우회 → `subscriptions` upsert(onConflict user_id) + `billing_events` insert(원자적, UPDATE 후 이벤트 INSERT 순서).
- webhook 라우트에서 **anon 클라이언트로만 호출** — `service_role` 키는 요청 경로에 등장하지 않음.

**불러오기 누적 카운터**: import AI 파싱은 저장 없는 호출도 과금되므로 호출 자체를 카운트. 신규 RPC `consume_lifetime_quota(p_bucket, p_max)` — 사용자별 버킷의 누적 성공 횟수를 세어 max 도달 시 차단(`rate_limit_events` 스토어 재사용 or 전용 `usage_counters`). free만 적용, pro는 스킵.

마이그레이션 후: **원격은 MCP `apply_migration` 수동 적용 필요**(git 커밋만으론 반영 안 됨), 이어서 `npm run db:gen-types`로 `src/types/database.ts` 재생성.

### 2. 플랜 판정 코어 — `src/lib/plan.ts` (신규, 순수 함수 TDD 선작성)

- `derivePlan(subscription, now): 'free' | 'pro'` — **순수 함수**. 행 없음→free, status active·기간 유효→pro, 취소예정이나 기간 미종료→pro, 만료/revoked→free. → `src/lib/__tests__/plan.test.ts` 먼저.
- `mapPolarStatusToPlan(polarStatus): {plan, status}` — webhook 이벤트→내부 상태 매핑, 순수 함수 + 테스트.
- `getUserPlan(): Promise<'free'|'pro'>` — `requireUser()` + subscription 조회 후 `derivePlan`.
- `assertProFeature()` — Pro 전용 기능 게이트, discriminated-union 에러(`{ok:false, error:'pro_only'}`) 반환.
- `IMPORT_FREE_LIMIT = 5` 상수 — `RATE_LIMITS`(`lib/rate-limit.ts`) 옆에.

### 3. 게이팅 삽입 지점 (기존 파일 최소 수정)

| 게이트 | 파일 | 방식 |
|---|---|---|
| **불러오기 5회** | `src/app/api/contracts/import/parse/route.ts` + `createImportedContract`(`contracts/actions.ts`) | 파싱 **전** `consume_lifetime_quota('ai_import_parse', 5)` (free만). 초과 시 업셀 메시지 |
| **새 계약 생성 (무료 1건)** | `contracts/actions.ts`(`createContractDraft`) + `src/app/api/contracts/draft/route.ts` + `contracts/new`·`ContractForm` 진입 | free는 생성한 새 계약 수 < 1이면 허용, 이후 업셀. (`consume_lifetime_quota('create_contract', 1)` 또는 생성 계약 count) |
| **서명 발송(쌍방, 무료 1건)** | `contracts/signature-actions.ts`(`sendSignatureRequest`) | free는 서명 진행한 새 계약 1건까지 허용, 이후 Pro. 서버 방어 이중 |
| CSV export | `src/app/api/reports/route.ts`(export 경로) | `assertProFeature` — free 403/업셀 |
| 고급 대시보드 | `dashboard/page.tsx`·`reports/page.tsx` | 채널/클라이언트 랭킹 섹션 free는 업셀 카드로 대체 |

TSA·완결증명서는 새 계약 서명 플로우 안에서만 산출되므로 별도 게이트 불필요(§Context).

### 4. Polar 연동 — `@polar-sh/nextjs`

- 설치: `npm install @polar-sh/nextjs`(zod 기존재).
- **env** (`src/lib/env.ts`에 `polarEnvSchema`+`getPolarEnv()` 추가, `.env.example` 갱신): `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_PRODUCT_ID`(Pro 상품), `POLAR_SERVER`(sandbox|production).
- **라우트 3종** (`src/app/api/billing/`):
  - `checkout/route.ts` — `Checkout({...})` GET. `customerExternalId = user.id`, `customerEmail` 전달, successUrl=설정 페이지.
  - `portal/route.ts` — `CustomerPortal({ getCustomerId })` GET. subscription 행의 `polar_customer_id` 반환.
  - `webhook/route.ts` — `Webhooks({ webhookSecret, onSubscriptionActive/Updated/Canceled/Revoked })` POST. 각 핸들러가 anon 클라이언트로 `upsert_subscription_from_polar` RPC 호출(§1). 서명 검증은 어댑터가 `webhookSecret`으로 수행.
- **UI**: `settings/page.tsx`에 결제 섹션 — 현재 플랜 배지, free는 "Pro 업그레이드"(→`/api/billing/checkout?products=$POLAR_PRODUCT_ID`), pro는 "구독 관리"(→`/api/billing/portal`). 신규 `src/components/billing/plan-badge.tsx`·`upgrade-cta.tsx`. 게이트 지점(불러오기 5회 초과·새 계약 생성)에 업셀 문구.

### 5. 문서

- `docs/ADR.md`: Polar 채택, Free/Pro 경계("불러오기 Free / 생성·서명 Pro"), **SECURITY DEFINER webhook 패턴** 근거.
- `docs/ARCHITECTURE.md` 데이터 모델에 `subscriptions`/`billing_events` + 게이팅 규칙 반영.

---

## 검증 (end-to-end)

1. **단위 테스트 (TDD 선작성)**: `npm run test` — `derivePlan`(만료/취소/무행), `mapPolarStatusToPlan`. free가 6번째 파싱·2건째 새 계약 생성·서명·CSV export 시 게이트 에러 반환(1건째는 허용).
2. **빌드/린트**: `npm run build`, `npm run lint`, `npm run test` 그린.
3. **Polar sandbox E2E**: `POLAR_SERVER=sandbox`로 checkout→결제→webhook→`subscriptions` pro 전환 확인. webhook 로컬 수신은 ngrok(Polar는 로컬 포워더 없음). dev-browser CLI로 업셀→checkout 리다이렉트 확인.
4. **게이트 실동작**: free로 새 계약 1건 생성·서명 성공(TSA·증명서 확인) → 2건째 차단, 불러오기 5회 후 6회째 차단, CSV export 차단 확인 → Pro 전환 후 전부 해제 확인.
5. **보안 회귀**: `subscriptions` 클라이언트 직접 INSERT/UPDATE 불가(RLS), webhook 라우트에 `service_role` 키 부재, `get_advisors`로 신규 테이블 RLS 린트.

## 열린 항목 (실행 중 확정)

- **[검증 완료 2026-07] Polar 한국 결제 현실** — Polar로 MVP 진행 가능(정산·KRW·카드 OK), 단 두 마찰 인지:
  - ✅ **정산**: 대한민국은 Polar 정산 지원국(195개국)에 포함. Stripe Connect Express로 한국 사업자 payout 가능. 머천트 심사 **~2주**(착수 일정에 반영).
  - ✅ **통화**: 다중통화 구현 완료(#7945, 2025-11). KRW 가격 설정 가능 — 대시보드에서 KRW 활성만 최종 확인.
  - ⚠️ **결제수단**: 한국 발급 Visa/Master **카드 결제만 가능**. 카카오페이·네이버페이·계좌이체 등 **국내 간편결제 미지원**(KakaoPay는 요청 목록에만). 카드 기피층 전환 손실 감수.
  - ⚠️ **세금계산서**: MoR(미국 법인)라 자기명의 invoice만 발행, **한국 세금계산서(홈택스) 발급 불가**. 사업자 경비처리 니즈 있는 사용자 이탈 가능. 사업자 비중 높으면 향후 국내 PG(토스페이먼츠·페이플)+자체 세금처리 이전 고려.
  - → **결론**: Polar 확정. 결제수단·세금계산서 마찰은 출시 후 사용자 피드백으로 국내 PG 이전 여부 재평가.
- **다운그레이드 데이터 처리**: Pro에서 만든 새 계약 N건이 free로 강등되면? 기존 계약은 읽기전용 유지(삭제 안 함), 신규 생성만 무료 1건 한도 재적용 — 정책 확정 필요.
- **결제 실패(past_due) 유예/강등 UX**: 카드 실패 시 즉시 강등 vs 유예기간(예: 3일). Polar webhook `subscription.past_due` 처리 + `current_period_end` 기준 grace.
- 불러오기/생성 누적 카운터 저장소: `rate_limit_events` 재사용 vs 전용 `usage_counters` 테이블 — §1에서 단순한 쪽.
- 파싱 preview(저장 안 함) 남용 방어: 누적 카운터가 성공 파싱을 세므로 실패/재시도 정책(성공만 카운트) 확정 + 기존 per-minute `aiPdfParse` rate-limit 병행.
- Pro 가격(월) 최종값은 Polar 대시보드에서 설정.

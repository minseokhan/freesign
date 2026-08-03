# 아키텍처

## 기술 스택
- **Next.js 15** (App Router, RSC + Server Actions) + **TypeScript strict**
- **Tailwind CSS + shadcn/ui**
- **Supabase**: Auth(Google OAuth) + Postgres + Storage. `@supabase/ssr`(쿠키 기반 서버/클라 클라이언트) + `middleware.ts` 토큰 갱신 + 생성 타입. 서버 인가는 `getUser()`(`getSession()` 아님). RLS로 `user_id` 스코프.
- **Claude API** (`@anthropic-ai/sdk`, tool-use/JSON) — 계약서 초안(문구 다듬기 + 평문 요약), 기존 계약 PDF 조항 추출, 독촉 메일 초안, 계약 인사이트
- **@react-pdf/renderer** — 계약서·인보이스·완결증명서 PDF. route `runtime='nodejs'` + `outputFileTracingIncludes`로 폰트/wasm 포함 + `maxDuration`. Pretendard 한글 전영역 임베드
- **Polar** (`@polar-sh/nextjs`) — Free/Pro 구독 결제. webhook은 SECURITY DEFINER RPC 경계(ADR-010)
- **Resend** (`services/email`) — 서명 요청·독촉·크론 알림 메일. `send()`는 어떤 실패에서도 throw하지 않는 best-effort
- **RFC 3161 TSA** (`services/timestamp`) — 서명 발송·완결 시점 타임스탬프(기본 freeTSA.org, `TSA_URL`로 교체)
- **Vercel Cron** — 단일 일일 잡 `/api/cron/daily`(21:00 UTC = 06:00 KST)가 독촉·반복 인보이스 스윕을 순차 실행(ADR-011)
- **폼·검증**: react-hook-form + **zod**(입력·jsonb·env 런타임 검증)
- **테스트**: Vitest(단위·통합) + Playwright(E2E) + GitHub Actions CI + Prettier / ESLint flat config
- **배포**: Vercel + Supabase 클라우드

## 디렉토리 구조
```
src/
├── app/
│   ├── (auth)/login          # Google 로그인
│   ├── (dashboard)/          # 인증 후: dashboard, clients, contracts, invoices(+recurring), reports, billing, settings
│   ├── (public)/sign/[token] # 비로그인 상대방 서명 화면 (anon DEFINER RPC 경유)
│   └── api/                  # 라우트 핸들러 — Claude·서명 해시·PDF·CSV·시크릿·webhook·크론은 여기서만
├── components/               # shadcn/ui 기반 UI (billing/·pdf/·landing/ 하위 그룹)
├── types/                    # 도메인 타입 + Supabase 생성 타입
├── lib/
│   ├── supabase/             # 서버/클라이언트/anon Supabase 인스턴스
│   ├── cron/                 # dunning-sweep·recurring-sweep (일일 크론 본체, server-only)
│   ├── recurring/            # 다음 생성일 계산·후보 필터 (순수 함수)
│   ├── plan.ts               # 플랜 판정·게이팅 (derivePlan은 순수 함수)
│   ├── tax.ts                # 원천징수 계산 (순수 함수)
│   ├── insights.ts           # 계약 인사이트 집계 (순수 함수)
│   └── metrics.ts            # 대시보드 집계 변환 (순수 함수)
└── services/
    ├── ai/                   # Claude — contract-draft·contract-import·dunning-draft·contract-insight
    ├── email/                # EmailProvider(Resend) + 순수 템플릿 렌더러
    ├── timestamp/            # TimestampProvider (RFC 3161 TSA)
    ├── signature/            # SignatureProvider (v1 간이 → v2 자체 맞서명으로 대체됨)
    └── payment/              # PaymentProvider (인보이스 정산 상태 — 실 PG는 여전히 v2)
```

## 페이지 구조 (IA)
```
/                     공개 랜딩(마케팅) — 인증 여부에 따라 CTA 분기 + 히어로 인터랙티브 데모
/login                로그인(Google)
/dashboard            미수금 합계·이달 수익·이번 달 예정 입금 KPI + 계약 파이프라인(단계별 건수) + 임박/지연 지급기한 + 채널 수익 TOP 위젯(Pro, free는 UpgradeCard)
/clients              클라이언트 목록(채널 태그 배지·필터)
/clients/[id]         클라이언트 상세 + 하위 계약 목록
/contracts            계약 목록
/contracts/new        AI 초안 생성 플로우(시나리오 A: 구조화 입력 → 초안 → 편집 → 확정)
/contracts/import     기존 계약 PDF 불러오기(시나리오 B: 업로드 → Claude 추출 → 검토 → 서명 없이 성사(signed) 저장, doc_hash는 원본 PDF 바이트로 산출)
/contracts/[id]       계약 상세 — 조항·평문요약·PDF·서명·하위 인보이스·이력 타임라인
/invoices             인보이스 목록(상태 필터·페이지네이션)
/invoices/[id]        인보이스 상세 — 원천징수 내역·정산 상태 토글·PDF·상태 이력 + 독촉 초안 검토 패널(Pro·연체 시)
/invoices/recurring   반복 인보이스 스케줄 목록(Pro 전용, free는 사이드바에서 숨김)
/invoices/recurring/new  반복 스케줄 생성 — 주기·지급기한 오프셋·원천징수 스냅샷
/reports              세금 요약(무료) + 채널·클라이언트 랭킹·계약 피드백 요약·CSV 내보내기(Pro)
/billing              요금제 — 현재 플랜 배지 + Free/Pro 비교 + Pro 기능 소개 + 업그레이드/구독 관리 CTA
/settings             프로필·기본 원천징수율·계좌정보
/sign/[token]         비로그인 상대방 서명 — 계약 열람·서명·완결 PDF/증명서 내려받기(anon DEFINER RPC 경유)

API 라우트(전부 서버 전용)
/api/contracts/draft              구조화 입력 → Claude 초안(과거 인사이트 요약을 prior_insights로 반영)
/api/contracts/import/parse       업로드 PDF를 Claude로 파싱해 추출 결과 미리보기 반환(저장 없음)
/api/contracts/[id]/pdf|source-pdf|certificate   계약서·원본·완결증명서 PDF
/api/contracts/[id]/sign          v1 단독 서명 잔재 — 맞서명 단일화 후 앱에서 호출하는 곳 없음
/api/contracts/[id]/insights      온디맨드 AI 계약 인사이트(Pro, free는 402 + upsell)
/api/invoices/[id]/pdf            인보이스 PDF
/api/sign/[token]/(route|pdf|certificate)   비로그인 서명 제출·완결 문서 교부
/api/reports                      세금 원장 CSV 내보내기(Pro)
/api/billing/(checkout|portal|webhook)      Polar 체크아웃·고객 포털·webhook(서명 검증 후 DEFINER RPC)
/api/cron/daily                   Vercel Cron 단일 진입점 — 독촉·반복 스윕(Bearer CRON_SECRET, fail-closed)
```

## 데이터 모델 (Postgres, RLS 활성)

```
clients
  id, user_id(FK auth.users), name,
  channel(text + CHECK: linkedin|instagram|youtube|direct|kmong|referral|other),  -- 진화 집합이라 enum 아님
  contact_email?, contact_phone?, memo?,
  is_demo(bool, default false), deleted_at?, created_at, updated_at

contracts
  id, user_id, client_id(FK, ON DELETE RESTRICT),
  title, scope(text), amount(bigint, 원),          -- v1 KRW 고정
  start_date, end_date,
  status(enum: draft|sent|signed|active|done|canceled),   -- sent = 맞서명 요청 발송 후 상대 서명 대기(0017)
  clauses(jsonb),           -- 확정 조항: [{title, body, plain_summary, needs_review}] · zod 검증
  plain_summary?(text),     -- 계약 레벨 평문요약 1급 컬럼(시나리오 A, 조항별 중복 대신 계약 1회) · 0010 마이그레이션
  contract_pdf_url?,        -- 서명 PDF 경로(private Storage key만 저장)
  source_pdf_url?,          -- 발주처 원본 PDF 경로(private Storage key, contract_pdf_url과 분리)
  signature_image_path?,    -- 서명 PNG 경로(private Storage key)
  doc_hash?(text),          -- 1급 컬럼 · canonical clauses JSON SHA-256 · 예시적 무결성(법적효력 v2)
  signature_meta?(jsonb),   -- {signer, signed_at, ip, ua} · IP/UA는 서버 라우트에서만 기록
  is_demo(bool, default false), deleted_at?, created_at, updated_at

invoices
  id, user_id, contract_id(FK, ON DELETE SET NULL, nullable), client_id(FK, ON DELETE RESTRICT),
  contract_snapshot?(jsonb),   -- 계약 물리 삭제 시 {title,amount,start_date,end_date} 스냅샷(서버 소유). 평소 NULL
  amount(bigint),           -- 청구 총액(원)
  issue_date, due_date,
  withholding_type(enum: wt_3_3|wt_8_8|none),
  withholding_amount(bigint),  -- 발행 시점 lib/tax.ts 스냅샷(발행 후 고정)
  net_amount(bigint),          -- amount - withholding_amount (스냅샷)
  payment_status(enum: draft|unpaid|paid),  -- overdue는 상태 아님: unpaid && due_date<today 파생
  paid_at?, payment_method?(text),
  is_demo(bool, default false), deleted_at?, created_at, updated_at

-- 감사·기록 체인 (append-only, RLS user_id, UPDATE/DELETE 정책 없음)
contract_events
  id, user_id, contract_id(FK, ON DELETE CASCADE), actor, from_status?, to_status, event_type, meta(jsonb), created_at
invoice_events
  id, user_id, invoice_id(FK), actor, from_status?, to_status, event_type, meta(jsonb), created_at

profiles
  user_id(PK/FK auth.users), display_name?, default_withholding_type(enum: wt_3_3|wt_8_8|none),
  bank_name?, bank_account_number?, bank_account_holder?, created_at, updated_at

-- 유료화(Polar) · 0024_billing
subscriptions
  user_id(PK/FK auth.users), plan(text CHECK free|pro, default free), status(text, default inactive),
  polar_customer_id?, polar_subscription_id?, current_period_end?, cancel_at_period_end(bool, default false), updated_at
  -- RLS: SELECT 본인 행만. INSERT/UPDATE 정책 없음 = 클라이언트 직접 쓰기 차단, upsert_subscription_from_polar(DEFINER)로만 기록.
billing_events   -- append-only 감사 로그(구독 이벤트)
  id, user_id, polar_subscription_id?, event_type, status?, meta(jsonb), created_at   -- SELECT 본인만, INSERT 정책 없음(RPC 내부에서만)
usage_counters   -- 무료 티어 누적 사용량 오도미터 (불러오기 파싱 등)
  user_id, bucket, used(int, default 0), updated_at, PK(user_id, bucket)   -- RLS 본인 행 CRUD, consume_lifetime_quota가 caller 권한으로 소비
billing_config   -- webhook 시크릿 저장(단일 행). RLS·grant로 anon/authenticated 차단, DEFINER 함수만 읽음
  id(bool PK, default true, CHECK id), webhook_secret, updated_at   -- Supabase postgres 롤이 커스텀 GUC ALTER 불가라 GUC 대신 테이블(0026)

-- 쌍방 전자서명 v2 (ADR-009) · 0018
signature_requests   -- owner가 보낸 서명 요청. 원문 토큰은 발송 순간만 존재, DB엔 SHA-256 해시만
  id, user_id, contract_id(FK CASCADE), token_hash(UNIQUE), recipient_email/name,
  status(enum: pending|completed|revoked), frozen_doc_hash, expires_at(발송+14일),
  first_viewed_at?, completed_at?, sent_tsa_token?, completion_tsa_token?, created_at
contract_signatures  -- 불변 증거(update/delete 정책 없음)
  id, user_id, contract_id(FK CASCADE), request_id(FK SET NULL), party(enum: owner|counterparty),
  signer_email/name, signature_image_path?(owner=Storage key) XOR signature_image_data?(counterparty=base64 ≤256KB),
  doc_hash, consent(jsonb), meta(jsonb), signed_at
rate_limit_events / anon_rate_limit_events   -- 비싼 AI·anon 표면의 슬라이딩 윈도우 카운터(0014·0018)

-- Pro 자동화 (ADR-011) · 0027~0030
cron_config      -- 크론 시크릿(단일 행). billing_config와 동일 하드닝, assert_cron_secret만 읽음
  id(bool PK, CHECK id), cron_secret, updated_at
dunning_reminders    -- 연체 독촉 초안. 생성은 크론 DEFINER RPC만(INSERT 정책 없음), 승인/무시는 소유자 UPDATE
  id, user_id, invoice_id(FK CASCADE), status(check: pending_review|sent|dismissed),
  draft_subject?, draft_body?, ai_source?('ai'|'fallback'), sent_at?, meta(jsonb), created_at
  -- 멱등: (invoice_id) WHERE status='pending_review' 부분 유니크 = 인보이스당 미검토 초안 1건
recurring_invoices   -- 반복 인보이스 스케줄. CRUD는 소유자 RLS, 인보이스 생성은 크론 DEFINER RPC
  id, user_id, contract_id?(FK CASCADE), client_id(FK CASCADE),
  amount, withholding_type, withholding_amount, net_amount,   -- 스케줄 생성 시 calcWithholding 스냅샷
  interval_kind(check: weekly|monthly), next_run_at(date), due_offset_days(default 14),
  active(default true), last_generated_at?, meta(jsonb), created_at
contract_insights    -- AI 계약 인사이트. 온디맨드(세션 있는 Pro API)에서만 생성, 크론 독립
  id, user_id, contract_id(FK CASCADE), summary, risk_level(check: low|medium|high),
  findings(jsonb: [{clause_title, severity, note}]), model?, source?('ai'|'fallback'), meta(jsonb), created_at
```
> 컬럼·정책·인덱스·RPC의 정본은 `supabase/migrations/`이며, 상세 정리는 `docs/DATABASE.md` 참조.

### 데이터 모델 규칙
- **공통 컬럼**: 도메인 3테이블 모두 `is_demo`(데모 시드 표식), `deleted_at`(soft-delete), `updated_at`(트리거 자동 갱신).
- **RLS**: SELECT/UPDATE는 `USING`, **INSERT/UPDATE는 `WITH CHECK (user_id = (select auth.uid()))` 둘 다 명시**(없으면 타 user_id 삽입·소유권 이관 가능). `select` 래핑으로 플래너 캐싱. 이벤트 테이블은 select/insert만 허용(UPDATE/DELETE 정책 없음 = append-only).
- **DB CHECK 제약**: `amount > 0`, `0 <= withholding_amount <= amount`, `net_amount >= 0`, `due_date >= issue_date`.
- **`deleted_at IS NULL` 필터는 RLS가 아니라 공용 쿼리 헬퍼에서** — RLS에 넣으면 soft-delete 행이 복원·감사·세금 CSV에서 사라짐(soft-delete 목적과 충돌). FK는 `ON DELETE RESTRICT` + 앱 레이어에서 "비삭제 하위가 있으면 부모 삭제 차단".
- **하드삭제**: 실데이터 `paid` 인보이스는 하드삭제 금지. `is_demo=true`만 예외("데모 지우기"). 데모 삭제 Server Action은 **demo 이벤트를 먼저 삭제한 뒤 demo 도메인 행 삭제**(FK RESTRICT 충돌 방지). 실데이터 이벤트는 여전히 append-only. **예외: 계약(contracts)은 상태 무관 물리 삭제**(ADR-008 갱신) — `deleteContract` Server Action이 ① 딸린 인보이스에 계약 스냅샷(`contract_snapshot`) 기록(계약 살아있는 동안) → ② 계약 행 DELETE(DB가 `invoices.contract_id` SET NULL + `contract_events` CASCADE 동시 처리) → ③ Storage 아티팩트 best-effort 제거 순으로 수행. 스냅샷을 삭제 앞에, 파일 정리를 DB 삭제 뒤에 둬 부분 실패 시 데이터 유실을 막는다.
- **계정 삭제(회원 탈퇴)**: soft-delete 대상이 아니라 **즉시 물리 삭제**(ADR-012). `deleteAccount` Server Action이 ① Storage `{user_id}/` 객체 제거(실패 시 여기서 중단 — DB는 건드리지 않는다) → ② `delete_own_account()` DEFINER RPC → ③ `signOut()` 순으로 수행. RPC 내부는 활성 구독 검사 → 결제 기록을 `billing_records_retained`로 익명 이관 → `invoice_events → invoices → contracts → clients` 명시 삭제 → `delete from auth.users` 순이다. **`auth.users` FK를 새로 만들 때는 반드시 `on delete cascade`를 붙일 것** — 빠뜨리면 계정 삭제가 런타임에 실패하고, `src/lib/db/__tests__/account-delete.test.ts`가 이를 잡는다.
- **원천징수 계산**(`lib/tax.ts`): 소득세(원 미만 절사) + 지방소득세(10원 미만 절사) 분리. 발행 시점 스냅샷 저장(drift 방지), draft 동안만 재계산.
- **인덱스**: 부분 인덱스 `(user_id) WHERE deleted_at IS NULL`, `(user_id, due_date) WHERE payment_status='unpaid'`, `(user_id, client_id)`, 이벤트 테이블 `(contract_id/invoice_id, created_at)`.
- **집계**: 대시보드·리포트 지표는 **SQL 집계**(`SUM`/`GROUP BY`) + `lib/metrics.ts` 순수 변환/포맷. 별도 집계 테이블 없음. "이달 수익"은 입금일 기준 — SQL `date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul')`(UTC 저장을 JS로 집계하면 KST 9시간 밀림).
- **플랜 게이팅**(ADR-010·011, `lib/plan.ts`): 유효 플랜은 순수함수 `derivePlan(subscription, now)`로 판정(만료·취소유예·revoked 포함). 게이트는 **free일 때만** 검사(pro는 무제한) → 업그레이드 즉시 해제. 게이트는 세 종류다.
  - **누적 상한**: 불러오기 파싱 5회는 `usage_counters`+`consume_lifetime_quota`(저장 여부와 무관하게 "호출 자체"를 카운트, 비용 기준).
  - **실데이터 count**: 새 계약 생성 1건·서명 발송 1건은 별도 카운터 없이 `contracts` 실시간 count(`source_pdf_url IS NULL`=생성 계약) — 다운그레이드 시 실데이터를 그대로 반영해 "기존 읽기전용·신규만 재적용" 정책과 자동 일치.
  - **Pro 전용**(`assertProFeature()`): 반복 인보이스·미수금 독촉 승인·AI 계약 인사이트·세금 CSV·채널/클라이언트 랭킹. Server Action은 `{ok:false,error}`, API 라우트는 402+`upsell:true`, 페이지는 `getUserPlan()`+`UpgradeCard`로 표면화한다.
  - **다운그레이드는 데이터를 지우지 않는다** — 뷰·자동화만 잠근다. 반복 인보이스는 크론 RPC의 `plan=pro` 조건이 free 유저 스케줄을 건너뛰어 생성만 일시중지(행 보존).
  - Webhook은 anon 클라이언트→`upsert_subscription_from_polar`(DEFINER, webhook 시크릿을 `billing_config` 저장값과 대조 fail-closed)로만 구독 행 기록.

## 패턴 (렌더링·데이터 접근)
- **읽기**: RLS 스코프된 **Server Component에서 직접 Supabase 조회**. 읽기를 내부 `/api` fetch로 우회하지 않는다(안티패턴).
- **쓰기(뮤테이션)**: **Server Actions에서만**. `revalidatePath`로 갱신, 토글류는 `useOptimistic`.
- **시크릿·외부 API**(Claude·서명 해시·PDF·CSV·이메일·TSA): `app/api/` 라우트 핸들러 또는 서버 전용 모듈에서만. 클라이언트 컴포넌트 직접 호출 금지. Claude PDF 추출(`contract-import.ts`)도 서버 전용 모듈과 `/api/contracts/import/parse` 라우트에서만 호출한다.
- **세션 없는 경계**(Polar webhook·일일 크론): anon 클라이언트(`lib/supabase/anon.ts`) → 시크릿 인자를 받는 SECURITY DEFINER RPC 하나만 호출. `service_role`은 요청 경로에서 여전히 금지.
- **크론은 초안까지만**: 스윕은 소유자 검토 대기물(`dunning_reminders.pending_review`·인보이스 `draft`)과 소유자 알림 메일만 만든다. 클라이언트 발송·인보이스 발행은 세션 있는 Server Action에서 승인 후에만 일어난다.
- **이메일은 best-effort**: `getEmailProvider().send()`는 throw하지 않고 `{ok,error}`를 돌려준다 — 메일 실패가 서명·독촉 트랜잭션을 되돌리지 않게.
- **인터랙션이 필요한 곳만 Client Component**(캔버스 서명·상태 토글·폼·독촉 초안 편집). 나머지는 RSC 기본.

## 데이터 흐름

**읽기(대시보드·목록·상세)**
```
사용자 → 보호 라우트(RSC) → getUser() 인가 → Supabase 직접 조회(RLS 스코프)
       → 쿼리 헬퍼(deleted_at IS NULL 필터) → SQL 집계 → lib/metrics.ts 변환 → UI
```

**쓰기(생성·상태 전이)**
```
폼(Client) → Server Action → zod allowlist 검증(도메인 필드만) → getUser()로 user_id 주입
           → FK 소유권 재검증(invoice→contract/client)
           → 단일 트랜잭션 RPC(*_with_event): 도메인 UPDATE + 이벤트 로그 INSERT를 원자적으로 함께 수행
           → revalidatePath → { ok } 반환(useActionState) 또는 useOptimistic 갱신
```

**쌍방 서명(ADR-009 · 부분 실패 최소화 순서)** — v1 단독 서명 플로우는 제거되고 맞서명 요청 하나로 단일화됐다.
```
발송  owner 캔버스 PNG → Server Action(sendSignatureRequest) → canSendSignature 게이트
      → Storage 업로드(private, {user_id}/{contract_id}/) + doc_hash 동결 + 토큰 생성(DB엔 SHA-256 해시만)
      → send_signature_request_with_event RPC: draft→sent + owner 서명 기록 + signature_requests INSERT + 이벤트 (원자적)
      → 커밋 후 best-effort: 상대방에게 서명 링크 메일(Resend) + 발송 시점 TSA 스탬프

서명  /sign/[token](비로그인) → anon DEFINER RPC(get_signing_session)로 열람
      → complete_counterparty_signature_with_event: pending·미만료·doc_hash==frozen_doc_hash 검증
        → counterparty 서명 INSERT + 요청 completed + sent→signed + 이벤트 (단일 트랜잭션)
      → 커밋 후 best-effort: 완결 TSA 스탬프(write-once) + 양측 완결 알림 + 완결증명서 교부
  ※ 업로드·해시·토큰을 RPC 앞에, 메일·TSA를 커밋 뒤에 둬 어느 쪽이 실패해도 상태가 미완으로 남지 않게 한다.
  ※ `/api/contracts/[id]/sign`은 v1 단독 서명 잔재로, 현재 앱에서 호출하는 곳이 없다.
```

**청구 전달(ADR-013 · 서명 패턴의 청구 단계 복제)**
```
발송  소유자 → Server Action(sendInvoice) → 레이트리밋(invoiceSend) → 소유·정산상태 재검증
      → 토큰 생성(DB엔 SHA-256 해시만) + 만료 계산(due_date+90일, 최소 30일)
      → send_invoice_with_event RPC: 기존 토큰 revoke + 새 토큰 INSERT + draft→unpaid + invoice.issued (원자적)
      → 커밋 후 best-effort: 청구 안내 메일(금액·기한·링크)
      → 메일 성공 시에만 append_invoice_event('invoice.sent')   ※ 도달 증거는 발송 성공에만 붙는다

열람  /invoice/[token](비로그인) → anon DEFINER RPC(get_invoice_view)로 금액·계좌·기한 열람 + first_viewed_at 기록
      → /api/invoice/[token]/pdf: 같은 RPC + 소유자 라우트와 동일한 renderInvoicePdf(두 사본의 문서번호가 같다)
  ※ 토큰이 DB에 있어야 링크가 유효하므로 "메일 먼저"는 불가능하다(서명 요청과 동일 제약).
    그래서 발행(invoice.issued)과 도달(invoice.sent)을 두 이벤트로 나눈다.
  ※ 클라이언트 이메일이 없으면 메일 없이 링크만 발급하고 소유자가 직접 전달한다.
  ※ 재발송은 항상 재발급 — 원문 토큰을 저장하지 않으므로 이전 링크는 회수된다(독촉 발송도 이 경로를 탄다).
```

**일일 크론(ADR-011 · 반자동)**
```
Vercel Cron(06:00 KST) → /api/cron/daily → Bearer CRON_SECRET 검증(불일치 401, fail-closed)
  → runDunningSweep:   anon → create_dunning_drafts_for_overdue(시크릿, cooldown)
                       → 후보별 Claude 독촉 초안(실패 시 정중한 한국어 폴백) → update_dunning_draft_body
                       → 소유자에게 "검토 대기" 알림 메일  ※ 클라이언트 발송 없음
  → runRecurringSweep: anon → generate_due_recurring_invoices(시크릿)
                       → 도래한 pro 스케줄마다 draft 인보이스 생성 + next_run_at 전진 → 소유자 알림
  두 스윕은 각각 try/catch로 격리(하나가 실패해도 나머지 진행), 집계 JSON 반환.

승인  소유자 → Server Action(approveAndSendDunning) → assertProFeature
      → 청구서 링크 재발급 → 클라이언트 발송 + 이벤트 로그 append
      ※ 반복 인보이스 draft는 sendInvoice로 발행·발송한다(무료, 위 청구 전달 흐름).
```

**AI 초안**
```
구조화 입력 → app/api(Claude, tool-use/JSON) → zod 검증(조항 needs_review)
           → 성공: draft 저장 / 실패·타임아웃: 템플릿 골격만 draft 저장 + 재시도(기존 draft 갱신, 멱등)
```

## 상태 관리
- **서버 상태**: Server Components에서 Supabase 직접 조회(단일 소스). 캐시 무효화는 `revalidatePath`.
- **뮤테이션 상태**: Server Actions + `useActionState`(에러 계약 `{ ok:false, error, fieldErrors? }`를 폼에 표면화).
- **낙관적 UI**: 정산 상태 토글 등은 `useOptimistic` — 실패 시 롤백 + 토스트.
- **폼 상태**: react-hook-form + zod 리졸버(클라이언트 검증) → Server Action에서 동일 스키마 재검증.
- **전역 클라이언트 상태 라이브러리 없음** — 서버가 소스이므로 Redux/Zustand류 미도입.

## 상태 전이 머신
- **contract.status**: `draft → sent → signed → active → done`(각 전이 명시적 버튼, `active/done` 수동). `sent`는 맞서명 요청 발송 후 상대 서명 대기 — 발송 즉시 조항이 잠기고, `sent/signed` 진입은 일반 전이 UI가 아니라 전용 절차(발송·서명 RPC)에서만 일어난다. `canceled`는 `done` 외 어디서든. 서명 후 조항 read-only — 편집하려면 `draft`로 되돌려 서명 아티팩트 초기화·재서명(문서 해시 무결성)하되, **counterparty 서명이 있으면 되돌리기·삭제 모두 차단**(앱 가드 + DB 트리거, ADR-009). 철회(revoke)는 `sent → draft`.
- **invoice.payment_status**: `draft → unpaid(발행) → paid(입금)`. `paid → unpaid` 되돌리기 허용(`paid_at`/`payment_method` 초기화). `overdue`는 상태가 아니라 `unpaid && due_date<today` 파생. 반복 스케줄이 만든 인보이스도 `draft`로 시작해 소유자가 검토·발행한다.
- **dunning_reminders.status**: `pending_review(크론 생성) → sent(소유자 승인·클라이언트 발송)` 또는 `→ dismissed(무시)`. 발송 시 `invoice_events`에 `invoice.dunning_sent` append.
- **signature_requests.status**: `pending → completed(상대 서명 완결)` 또는 `→ revoked(발송자 철회)`. 계약당 pending 1건(부분 유니크).
- 모든 전이는 이벤트 로그에 append → 상세 화면 이력 타임라인으로 노출.

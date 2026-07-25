# FreeSign Pro 3-기능 통합 구현 계획 — 미수금 독촉 · 반복 인보이스 · AI 계약 인사이트

## Context (왜)

FreeSign 유료화(Polar 월 구독)는 이미 구현·sandbox E2E 검증까지 끝났다. 하지만 가격 전략을 점검하며 **구조적 문제**가 드러났다:

- **매달 쓰는 가치(인보이스 발행·입금추적·미수금 대시보드)는 전부 Free**, **Pro의 대표 가치(새 계약 생성·서명)는 몰아서 쓰는(bursty) 기능**이다.
- 프리랜서 작업은 "계약 1건 → 몇 달 작업"이라, 월 구독인데 **"이번 달 쓴 것도 없는데 왜 내지?"** 저항이 생긴다.

**해법(사용자와 합의):** Pro의 정체성을 *"무제한 계약 생성"* → **"청구·수금 자동화 + 인사이트"**로 재배치한다. 매달 가치가 발생하는 3개 기능을 신설해 월 구독을 정당화한다. 기록·조회는 계속 무료(락인 유지), **데이터는 다운그레이드해도 절대 삭제하지 않고 자동화/뷰만 게이트**한다.

**신규 3기능 (전부 Pro):**
1. **미수금 자동 독촉** — 연체 인보이스에 AI가 독촉 메일 *초안*을 만들고, 사용자 *승인 후* 클라이언트에 발송(반자동).
2. **반복(구독형) 인보이스** — 매 주기 인보이스 *초안*을 자동 생성하고, 사용자 *검토 후* 발행(반자동, 리테이너 세그먼트 정조준).
3. **AI 계약 인사이트** — 과거 계약을 AI가 읽어 조항 약점/누락 피드백을 도출. 온디맨드 분석 + **새 계약 초안 생성 시 과거 인사이트 자동 반영** + 리포트에 종합 피드백 요약.

## 설계 원칙 (기존 패턴에 고정 — 과설계 금지)

- **크론은 클라이언트에 자동발송하지 않는다.** 크론 산출물은 항상 소유자(프리랜서)가 앱에서 검토·승인하는 대기 상태(`pending_review`/`draft`). 실제 클라이언트 발송·발행은 세션 있는 Server Action에서만.
- **세션 없는 크론의 멀티유저 쓰기**는 billing 시크릿 패턴(`0026_billing_secret_table.sql`) 응용: anon 클라이언트 → `p_cron_secret` 인자를 받는 `SECURITY DEFINER` RPC → 내부에서 `cron_config` 대조(fail-closed) 후 RLS 우회. **`service_role`는 요청 경로 금지**(`src/lib/supabase/anon.ts` 재사용).
- AI 서비스는 `src/services/ai/contract-import.ts`·`contract-draft.ts` 골격 복제: `tool_use` 강제 + strict `input_schema` + zod 검증 + 결정론적 폴백 + 재시도 + `captureServerException`. **Claude는 게이트가 아니라 향상 요소.**
- 이메일은 `getEmailProvider().send()`(best-effort, throw 안 함) + `src/services/email/templates.ts` 순수함수(+`escapeHtml`) 신규 템플릿.
- 세금 계산은 `calcWithholding`(`src/lib/tax.ts`)로 **세션 있는 Server Action에서** 계산해 스냅샷 저장 → 크론 RPC는 순수 복사만(SQL에 세금 로직 중복 금지).
- 연체 판정은 `deriveDueStatus()`(`src/lib/metrics.ts`) 재사용(SQL에선 `due_date < current_date` 등가).
- 게이트는 `src/lib/plan.ts` 재사용: Server Action은 `assertProFeature()`→`{ok:false,error}`, API route는 402+`upsell:true`, page는 `getUserPlan()`+`UpgradeCard`.
- 마이그레이션은 `0027_`부터, 상단 한국어 보안주석 + RLS(`using (user_id=(select auth.uid()))`) + `(user_id, created_at)` 인덱스 + `revoke all from public`/`grant execute` 하드닝. append-only 이벤트로그는 SELECT-own 정책만(INSERT는 RPC 내부만).

---

## Phase 0 — 공통 스케줄러 인프라 (필수 선행)

**스케줄러 부재**가 최대 공백(vercel.json 없음, supabase/functions 없음, pg_cron 0건). Vercel Cron으로 신규 구축 — 기존 API Route 패턴에 최소 표면으로 부합.

- **제약:** Vercel Hobby = 크론 **1일 1회 + 잡 수 제한**. → 개별 크론 대신 **단일 일일 크론** `/api/cron/daily`(예: `0 21 * * *` UTC = 06:00 KST)가 내부에서 dunning·recurring 스윕을 순차 호출.
- 신규 파일:
  - `vercel.json` — `{ "crons": [{ "path": "/api/cron/daily", "schedule": "0 21 * * *" }] }`
  - `src/app/api/cron/daily/route.ts` — `runtime="nodejs"`. `Authorization: Bearer ${CRON_SECRET}` **fail-closed** 검증(불일치 401) → `runDunningSweep()` + `runRecurringSweep()` 각각 try/catch 격리 → 집계 JSON 반환.
  - `src/app/api/cron/_lib/authorize.ts` — `authorizeCron(req): boolean` 순수 유틸(TDD).
- 신규 마이그레이션 `0027_cron_infra.sql`:
  - `cron_config` 테이블 — `billing_config`와 구조·하드닝 동일(단일행 `id boolean pk check(id)`, `cron_secret text`, RLS enabled + **정책 없음** + `revoke all from anon, authenticated`).
  - `assert_cron_secret(p_secret text)` — `SECURITY DEFINER`, 미설정/불일치면 `raise exception 'unauthorized cron call'`. Phase 1/2 DEFINER RPC가 첫 줄에서 호출. `grant to anon, authenticated`(보안은 시크릿 게이트가 담당).
- env: `src/lib/env.ts`에 `cronEnvSchema = z.object({ CRON_SECRET: z.string().min(1) })` + `getCronEnv()`. `.env.example` + Vercel env에 `CRON_SECRET` 추가. 마이그레이션 후 `cron_config.cron_secret`를 **동일 값으로 수동 update**(SQL Editor, billing_config와 동일 절차).
- 검증: `authorizeCron` Vitest(정상 통과/누락·불일치 401), `curl -H "Authorization: Bearer <CRON_SECRET>" .../api/cron/daily` → 401/200.

## Phase 1 — 미수금 자동 독촉 (반자동)

- 마이그레이션 `0028_dunning.sql`:
  - `dunning_reminders` — `id, user_id(FK cascade), invoice_id(FK cascade), status check in ('pending_review','sent','dismissed'), draft_subject, draft_body, ai_source, sent_at, meta jsonb, created_at`. 인덱스 `(user_id,created_at)`,`(invoice_id)`, **멱등 부분 유니크** `unique (invoice_id) where status='pending_review'`.
  - RLS: select_own·update_own(caller). **INSERT 정책 없음** → 생성은 크론 DEFINER RPC 내부만.
  - `create_dunning_drafts_for_overdue(p_cron_secret, p_cooldown_days)` `SECURITY DEFINER`: `assert_cron_secret` → 연체 후보(`payment_status='unpaid' and due_date<current_date and deleted_at is null` + 미검토 draft 없음 + cooldown 내 sent 없음) placeholder row insert → 후보 반환. AI 본문은 sweep에서 채움.
  - `update_dunning_draft_body(p_cron_secret, p_reminder_id, p_subject, p_body, p_source)` DEFINER — sweep이 AI 초안으로 본문 채움.
- AI 서비스 `src/services/ai/dunning-draft.ts` — `generateDunningDraft({clientName, contractTitle, amountNet, dueDate, daysOverdue, freelancerName})`. `contract-draft.ts` 골격 복제 + 정중한 한국어 폴백 + `captureServerException(feature:"ai_dunning_draft")`. 모델 상수 `ANTHROPIC_CONTRACT_MODEL` 재사용.
- 이메일 템플릿(`src/services/email/templates.ts`): `renderDunningEmail`(클라이언트용) + `renderOwnerDunningReviewEmail`(소유자 "검토 대기" 알림).
- 크론 `src/lib/cron/dunning-sweep.ts`: `create_dunning_drafts_for_overdue` → 후보별 `generateDunningDraft`→`update_dunning_draft_body` → 유저별 소유자 알림 메일(best-effort). **클라이언트 발송 없음.**
- 승인/발송 `src/app/(dashboard)/invoices/dunning-actions.ts`(신규 `"use server"`):
  - `approveAndSendDunning(reminderId, editedSubject?, editedBody?)` — `requireUser`→**`assertProFeature()`**→소유·pending 검증→(선택)수정본→`renderDunningEmail`→`getEmailProvider().send()` to **클라이언트**→성공 시 `status='sent',sent_at=now()` + `invoice_events`에 `invoice.dunning_sent` append→PostHog. zod allowlist(reminderId uuid, edited* 길이상한).
  - `dismissDunning(reminderId)` — `assertProFeature`→`status='dismissed'`.
- UI: 인보이스 상세(`invoices/[id]/page.tsx`)에 연체+pending_review 시 "독촉 초안 검토" Card(미리보기+수정 textarea+발송/무시). 대시보드/목록에 "검토 대기 독촉 N건" 배지. 컴포넌트 `src/components/dunning-review-panel.tsx`(client). Pro 아니면 `UpgradeCard`.
- 멱등성: 부분 유니크(pending당 1건) + RPC `NOT EXISTS`/cooldown 가드 + 발송 시 `invoice_events` 기록.
- 검증(TDD): `generateDunningDraft` 폴백·`renderDunningEmail` escape 단위테스트; `approveAndSendDunning` free 차단/pro 통과(기존 `actions.test.ts` 패턴); RPC cooldown·중복방지(psql); 수동(연체 seed→크론→소유자 메일(console)→승인→클라 메일).

## Phase 2 — 반복(구독형) 인보이스 (반자동)

- 마이그레이션 `0029_recurring_invoices.sql`:
  - `recurring_invoices` — `id, user_id, contract_id(FK), client_id(FK), amount, withholding_type, withholding_amount, net_amount(calcWithholding 스냅샷), interval_kind check in ('weekly','monthly'), next_run_at date, due_offset_days int, active bool default true, last_generated_at, meta, created_at`. 인덱스 `(user_id,created_at)`, 부분 `(next_run_at) where active`.
  - RLS: select/insert/update/delete own(caller) — 스케줄 CRUD는 세션 있는 Server Action.
  - `generate_due_recurring_invoices(p_cron_secret)` `SECURITY DEFINER`: `assert_cron_secret` → `active and next_run_at<=current_date` **and 소유자 plan=pro**(SQL에서 `derivePlan` 등가: `exists subscriptions where plan='pro' and status<>'revoked' and (current_period_end is null or current_period_end>now())`) 후보 → 각 건 **draft 인보이스** insert(`issue_invoice_with_event` 복제하되 `payment_status='draft'`, `p_event_type='invoice.draft_generated'`) + `next_run_at` 다음 주기 전진 + `last_generated_at=now()` → 생성 목록 반환. (세금은 스케줄 스냅샷 복사.)
- 다음 주기 계산 순수함수 `src/lib/recurring/schedule.ts`(weekly/monthly, 월말 경계) — **Vitest 집중 대상**.
- 크론 `src/lib/cron/recurring-sweep.ts`: `generate_due_recurring_invoices` → 유저별 "검토 대기 초안 N건" 소유자 알림(`renderOwnerRecurringNoticeEmail`). **클라이언트 발송/발행 없음.**
- 스케줄 CRUD `src/app/(dashboard)/invoices/recurring/actions.ts`: `createRecurringSchedule`(`assertProFeature`+zod allowlist+`calcWithholding` 스냅샷)/`pause`/`resume`/`delete`. 페이지 `invoices/recurring/page.tsx`(Pro 아니면 `UpgradeCard`).
- draft 발행: `setInvoicePayment`은 unpaid↔paid만 다루므로 신규 `publishDraftInvoice(invoiceId)` Server Action(draft→unpaid + `invoice.issued` 이벤트) 추가. 인보이스 상세에서 "이 초안 발행" 액션.
- 다운그레이드 정책: **pause(발행분 유지)** — 크론 RPC의 `plan=pro` 조건이 free 유저 스케줄을 자동 건너뜀(생성 중단). 이미 생성된 draft/발행 인보이스 보존, `active`는 유지(재구독 시 자동 재개). UI에 "무료 전환으로 반복 생성 일시중지" 안내.
- 검증(TDD): `schedule.ts` 다음주기·월말 경계 단위테스트; `createRecurringSchedule` free 차단; RPC due 선별+free 제외+`next_run_at` 전진 멱등(같은 날 2회 호출 중복 없음)(psql); 수동(스케줄 seed→크론→draft+소유자 메일→발행).

## Phase 3 — AI 계약 인사이트 (크론 독립, 병렬 가능)

- 마이그레이션 `0030_contract_insights.sql`:
  - `contract_insights` — `id, user_id, contract_id(FK cascade), summary, risk_level check in ('low','medium','high'), findings jsonb([{clause_title,severity,note}]), model, source, meta, created_at`. 인덱스 `(user_id,created_at)`,`(contract_id,created_at desc)`. RLS: select/insert own(caller).
- AI 서비스 `src/services/ai/contract-insight.ts` — `generateContractInsight({title, clauses, plainSummary})`. `contract-import.ts` 골격 복제(PDF document 블록 대신 clauses를 text 블록으로): `tool_use return_contract_insight`(summary_ko, risk_level, findings[]) + strict schema + zod + 중립 폴백 + `captureServerException(feature:"ai_contract_insight")`. "비법률자문·검토보조" 디스클레이머 재사용.
- 온디맨드 API `src/app/api/contracts/[id]/insights/route.ts`(POST): `requireUser`→**`assertProFeature()`→free 402+`upsell:true`**→소유 계약 조회→`consumeRateLimit`(신규 버킷 `ai_contract_insight`, `RATE_LIMITS`에 추가)→`generateContractInsight`→`contract_insights` insert→최신 반환. 컴포넌트 `src/components/contract-insight-panel.tsx`(client, "AI 인사이트 분석" 버튼, 402면 업그레이드 CTA).
- 새 draft 자동 반영: `src/services/ai/contract-draft.ts`의 `ContractDraftInput`에 `priorInsights?: string[]` 추가 → `buildClaudeRequest` `structured_input`에 포함(system에 "과거 인사이트 반영해 위험 조항 보완, 골격 유지" 1줄). 호출부(`contracts/actions.ts`/`api/contracts/draft/route.ts`)에서 draft 생성 전 유저 최근 `contract_insights.summary` N개 조회해 전달(free는 insight 없어 자연히 빈 배열, 폴백은 무시).
- 리포트 요약: `reports/page.tsx`에 기존 `isPro`/`UpgradeCard` 패턴으로 "종합 계약 피드백 요약" Card(위험도 분포 + 최근 공통 findings top N; `contract_insights` 집계 select 또는 `get_report_contract_insights` RPC). `!isPro`면 `UpgradeCard`.
- 상세 페이지(`contracts/[id]/page.tsx`)에 `contract-insight-panel` Card 삽입.
- 검증(TDD): `generateContractInsight` 폴백·findings 정규화 단위테스트; API free 402/pro 200 + rate-limit 초과(기존 route.test.ts 패턴); `buildClaudeRequest`가 `priorInsights` payload 포함(스냅샷); 수동(상세 분석→저장→새 draft 주입 확인→리포트 요약 표시).

---

## Phase 간 의존성 & 권장 실행 순서

1. **Phase 0 (필수 선행)** — Phase 1·2가 크론·`assert_cron_secret`에 의존.
2. **Phase 1 (독촉)** — Phase 0 위. AI 서비스/이메일 템플릿/스윕 골격을 여기서 처음 세워 Phase 2가 재사용.
3. **Phase 2 (반복)** — Phase 0 + Phase 1 패턴 재사용.
4. **Phase 3 (인사이트)** — 크론 **독립**, 언제든 병렬. 단 "저장→주입→리포트" 순.

권장: **0 → 1 → 2 순차, 3은 병렬.** 각 Phase는 독립적으로 커밋·배포 가능(월 구독 정당화는 Phase 1만으로도 시작됨).

## Free/Pro 게이트 위치 요약

| 기능 | 게이트 지점 | 방식 |
|---|---|---|
| 독촉 승인·발송 | `approveAndSendDunning`/`dismissDunning` | `assertProFeature()`→`{ok:false,error}` |
| 반복 스케줄 생성 | `createRecurringSchedule` | `assertProFeature()` |
| 반복 크론 생성 | `generate_due_recurring_invoices` RPC | SQL `plan=pro` 조건(다운그레이드 자동 pause) |
| 인사이트 온디맨드 | `/api/contracts/[id]/insights` | `assertProFeature()`→402+`upsell:true`+`consumeRateLimit` |
| 리포트 인사이트 요약 | `reports/page.tsx` | `isPro`→`UpgradeCard` |
| draft 인사이트 주입 | 생성 흐름 | 게이트 없음(free는 insight 없어 빈 배열) |

## 신규 마이그레이션
`0027_cron_infra.sql` · `0028_dunning.sql` · `0029_recurring_invoices.sql` · `0030_contract_insights.sql`
(원격 반영은 MCP `apply_migration` 수동 + `cron_config`/시크릿 update는 SQL Editor 직접, billing과 동일 절차)

## 복제 원본(Critical Files)
- `supabase/migrations/0026_billing_secret_table.sql` — 크론 시크릿 fail-closed 게이트·DEFINER 하드닝 청사진
- `supabase/migrations/0012_domain_event_functions.sql` — `issue_invoice_with_event` 복제원(반복 draft RPC·독촉 이벤트)
- `src/services/ai/contract-import.ts` / `contract-draft.ts` — AI 서비스 골격(dunning-draft·contract-insight)
- `src/app/(dashboard)/contracts/signature-actions.ts` — best-effort 이메일 + "RPC 커밋 후 외부호출 분리" 패턴
- `src/lib/plan.ts` — 게이트 3종(assertProFeature·getUserPlan·consume*)
- `src/lib/metrics.ts`(`deriveDueStatus`) · `src/lib/tax.ts`(`calcWithholding`) — 연체판정·세금 재사용

## 최종 검증 (end-to-end)
1. `npm run test` — 신규 순수함수(`authorizeCron`·`schedule.ts` 다음주기·AI 폴백·게이트) + 기존 560개 그린 유지.
2. `npm run build`·`npm run lint` 그린.
3. 로컬 크론 수동 트리거: 연체 인보이스·반복 스케줄 seed → `curl` 크론 → dunning/recurring draft 생성 + 소유자 메일(console provider) 확인.
4. 반자동 발송: 앱에서 독촉 승인→클라 메일, 반복 draft→발행 확인.
5. 인사이트: 계약 상세 분석→저장→새 계약 draft에 주입 확인→리포트 요약 칸.
6. 게이트 회귀: free로 각 기능 402/차단, pro로 해제. `get_advisors`로 신규 테이블 RLS 린트.
7. 크론 보안: 잘못된/누락 `CRON_SECRET` 401, `cron_config` 미설정 시 RPC fail-closed.

---

## 열린 항목 (실행 중 확정)

- **Vercel Cron 티어**: Hobby(일 1회) 가정. 독촉/반복을 하루 여러 번 돌리려면 Vercel Pro 필요. 현재 설계는 일 1회로 충분.
- **AI 인사이트 무료 체험**: 현재 Pro 전용(402). 전환 유도용 무료 1~2회 체험을 줄지는 출시 후 결정(주면 `consume_lifetime_quota` 버킷 추가).
- **독촉 발신 도메인**: 클라이언트 발송은 Resend `EMAIL_FROM` 도메인 인증 필요(미인증 시 onboarding@resend.dev는 본인 계정에만). 소유자 알림은 무관.
- **가격 재조정**: 이 재설계와 함께 연 구독 도입/월가 조정은 별도 논의(BILLING_PLAN 후속).

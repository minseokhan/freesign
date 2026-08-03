# 데이터베이스 구조

FreeSign의 Postgres(Supabase) 스키마 정리. `supabase/migrations/`의 마이그레이션을 기준으로 하며, 마이그레이션이 정본(source of truth)이다.

**핵심 도메인 흐름:** `clients`(고객) → `contracts`(계약) → `invoices`(청구/입금) → 리포트/세금 정리. 계약·인보이스의 상태 전이는 각각 `contract_events`·`invoice_events`에 append-only로 기록된다.

**공통 규칙**
- 모든 사용자 데이터 테이블은 `user_id`로 스코프되고 RLS로 격리된다(§ RLS 참조).
- 소프트 삭제: `deleted_at IS NULL`이 활성 레코드. 필터는 RLS가 아니라 공용 쿼리 헬퍼에서 적용(복원·감사·CSV 보존 목적).
- 금액은 모두 `bigint`(원 단위, KRW). 소수점 없음.
- 타임스탬프는 `timestamptz`, 리포트 집계의 연/월 경계는 KST(`Asia/Seoul`) 기준.
- `created_at`/`updated_at`은 기본값 `now()`, `updated_at`은 `set_updated_at()` 트리거로 갱신(events 테이블 제외).

---

## ENUM 타입

| 타입 | 값 | 용도 |
|------|-----|------|
| `contract_status` | `draft`, `sent`, `signed`, `active`, `done`, `canceled` | 계약 상태. `sent`는 맞서명 요청 발송 후 상대 서명 대기(0017) |
| `withholding_type` | `wt_3_3`, `wt_8_8`, `none` | 원천징수 유형(사업소득 3.3% / 기타소득 8.8% / 없음) |
| `payment_status` | `draft`, `unpaid`, `paid` | 인보이스 결제 상태 |
| `signature_request_status` | `pending`, `completed`, `revoked` | 서명 요청 상태(0018) |
| `contract_signature_party` | `owner`, `counterparty` | 서명 당사자 구분(0018) |
| `invoice_share_status` | `active`, `revoked` | 공개 청구서 링크 상태(0046) |

---

## clients — 고객

거래 상대(클라이언트). 계약·인보이스가 참조하는 최상위 엔티티.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | uuid PK | 고객 식별자 |
| `user_id` | uuid FK→auth.users | 소유 사용자 |
| `name` | text NOT NULL | 고객명 |
| `channel` | text NOT NULL | 유입 채널. `linkedin`/`instagram`/`youtube`/`direct`/`kmong`/`referral`/`other` 중 하나(CHECK) |
| `contact_email` | text | 연락 이메일 |
| `contact_phone` | text | 연락 전화 |
| `memo` | text | 자유 메모 |
| `is_demo` | boolean, 기본 false | 데모 시드 데이터 여부(데모만 삭제 허용) |
| `deleted_at` | timestamptz | 소프트 삭제 시각(NULL = 활성) |
| `created_at` / `updated_at` | timestamptz | 생성/수정 시각 |

---

## contracts — 계약

고객과의 개별 계약. 서명·PDF·해시 등 증빙 메타를 함께 보관한다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | uuid PK | 계약 식별자 |
| `user_id` | uuid FK→auth.users | 소유 사용자 |
| `client_id` | uuid FK→clients (ON DELETE RESTRICT) | 대상 고객 |
| `title` | text NOT NULL | 계약 제목 |
| `scope` | text NOT NULL | 업무 범위 |
| `amount` | bigint NOT NULL, `> 0` | 계약 금액(원) |
| `start_date` / `end_date` | date NOT NULL | 계약 기간 |
| `status` | contract_status, 기본 `draft` | 계약 상태(§ ENUM) |
| `clauses` | jsonb, 기본 `[]` | 계약 조항 목록 |
| `plain_summary` | text | 계약 레벨 평문요약(시나리오 A는 계약 1회, 0010 마이그레이션). 조항별 요약은 `clauses[].plain_summary` |
| `contract_pdf_url` | text | FreeSign이 생성한 서명본 PDF의 Storage key |
| `source_pdf_url` | text | 고객이 제공한 원본 PDF의 Storage key. 출처 보존을 위해 서명본과 분리 |
| `signature_image_path` | text | 서명 이미지 Storage 경로 |
| `doc_hash` | text | 서명 대상 문서 해시(무결성 증빙, 서버 소유 필드) |
| `signature_meta` | jsonb | 서명 메타데이터(시각·IP 등, 서버 소유 필드) |
| `is_demo` | boolean, 기본 false | 데모 데이터 여부 |
| `deleted_at` | timestamptz | 소프트 삭제 시각 |
| `created_at` / `updated_at` | timestamptz | 생성/수정 시각 |

> `contract_pdf_url`·`source_pdf_url`·`doc_hash`·`signature_meta`·`status`는 서버 소유 필드로 클라이언트 입력을 받지 않는다.

---

## invoices — 청구/입금

계약에 대한 청구서. 원천징수·실수령액·결제 상태를 기록하며 세금 정리의 원장 역할을 한다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | uuid PK | 인보이스 식별자 |
| `user_id` | uuid FK→auth.users | 소유 사용자 |
| `contract_id` | uuid FK→contracts (ON DELETE SET NULL), nullable | 원 계약. 계약이 물리 삭제되면 NULL로 끊긴다 |
| `contract_snapshot` | jsonb, nullable | 계약 삭제 시점의 `{title, amount, start_date, end_date}` 스냅샷(서버 소유 필드). 계약이 살아있으면 NULL, 삭제 시 액션이 채운다 |
| `client_id` | uuid FK→clients (ON DELETE RESTRICT) | 청구 대상 고객 |
| `amount` | bigint NOT NULL, `> 0` | 청구 총액(원, 세전) |
| `issue_date` | date NOT NULL | 발행일 |
| `due_date` | date NOT NULL, `>= issue_date` | 지급 기한 |
| `withholding_type` | withholding_type NOT NULL | 원천징수 유형(§ ENUM) |
| `withholding_amount` | bigint NOT NULL, `0 <= x <= amount` | 원천징수액 |
| `net_amount` | bigint NOT NULL, `>= 0` | 실수령액(= amount − withholding) |
| `payment_status` | payment_status, 기본 `draft` | 결제 상태(§ ENUM) |
| `paid_at` | timestamptz | 입금 시각(서버 소유 필드). 리포트의 연/월 귀속 기준 |
| `payment_method` | text | 입금 수단 |
| `is_demo` | boolean, 기본 false | 데모 데이터 여부 |
| `deleted_at` | timestamptz | 소프트 삭제 시각 |
| `created_at` / `updated_at` | timestamptz | 생성/수정 시각 |

> `amount`·`withholding_amount`·`net_amount`(금액 스냅샷), `payment_status`·`paid_at`·`contract_snapshot`은 서버 소유 필드.

---

## contract_events / invoice_events — 상태 전이 로그

상태 변경을 기록하는 append-only 감사 로그. 도메인 UPDATE와 이벤트 INSERT는 단일 트랜잭션 RPC(§ 도메인 뮤테이션 함수)로 원자적으로 함께 수행된다(부분 실패 방지). 두 테이블은 참조 대상만 다르고 구조가 동일하다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | uuid PK | 이벤트 식별자 |
| `user_id` | uuid FK→auth.users | 소유 사용자 |
| `contract_id` / `invoice_id` | uuid FK | 대상 계약/인보이스. `contract_events.contract_id`는 ON DELETE CASCADE(계약 물리 삭제 시 함께 제거) |
| `actor` | text NOT NULL | 상태를 바꾼 주체 |
| `from_status` | text | 이전 상태(최초 생성 시 NULL 가능) |
| `to_status` | text NOT NULL | 이후 상태 |
| `event_type` | text NOT NULL | 이벤트 종류 |
| `meta` | jsonb, 기본 `{}` | 부가 정보 |
| `created_at` | timestamptz | 발생 시각 |

> events 테이블은 append-only라 `updated_at`·`deleted_at`이 없다.

---

## signature_requests — 맞서명 요청 (0018)

owner가 상대방에게 보낸 서명 요청. 원문 토큰은 발송 순간에만 존재하고 DB엔 SHA-256 해시만 저장한다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | uuid PK | 요청 식별자 |
| `user_id` | uuid FK→auth.users | 계약 소유자 |
| `contract_id` | uuid FK→contracts (ON DELETE CASCADE) | 대상 계약. 미서명 요청은 계약과 함께 소멸 |
| `token_hash` | text NOT NULL UNIQUE | 서명 토큰의 SHA-256 해시(32~128자 CHECK) |
| `recipient_email` / `recipient_name` | text | 수신자(이메일 필수, 길이 CHECK) |
| `status` | signature_request_status, 기본 `pending` | 요청 상태. `(contract_id) WHERE status='pending'` partial unique로 계약당 대기 1건 |
| `frozen_doc_hash` | text NOT NULL | 발송 시점에 동결한 문서 해시(64자). 서명 시점 일치 검증 |
| `expires_at` | timestamptz NOT NULL | 만료(발송 후 14일) |
| `first_viewed_at` / `completed_at` | timestamptz | 최초 열람·완결 시각 |
| `sent_tsa_token` / `completion_tsa_token` | text | RFC 3161 TST base64(발송·완결 시점, 커밋 후 best-effort. 완결 토큰은 write-once) |
| `created_at` | timestamptz | 생성 시각 |

---

## contract_signatures — 서명 증거 (0018)

계약별 서명자 증거. **update/delete RLS 정책이 없어 불변** — 되돌리기·삭제로 지워지지 않는다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | uuid PK | 서명 식별자 |
| `user_id` | uuid FK→auth.users | 계약 소유자(스코프 기준, 서명자가 아님) |
| `contract_id` | uuid FK→contracts (ON DELETE CASCADE) | 대상 계약(단 counterparty 서명 존재 시 계약 삭제 자체가 트리거로 차단됨) |
| `request_id` | uuid FK→signature_requests (SET NULL) | 유발한 서명 요청. counterparty는 요청당 1건(partial unique) |
| `party` | contract_signature_party | `owner` / `counterparty` |
| `signer_email` / `signer_name` | text | 서명자 신원(이메일 소유확인 수준) |
| `signature_image_path` | text | owner 서명의 Storage key |
| `signature_image_data` | text | counterparty 서명 PNG base64(≤256KB CHECK). anon은 Storage RLS를 못 쓰므로 DB 저장 — "DB엔 key만" 규칙의 명시적 예외(ADR-009) |
| `doc_hash` | text NOT NULL | 서명 시점 문서 해시(64자) |
| `consent` | jsonb | 동의 캡처(전자서명·개인정보, 동의 시각) |
| `meta` | jsonb | ip/ua 등 감사 메타 |
| `signed_at` | timestamptz | 서명 시각 |

> `signature_image_path` XOR `signature_image_data` CHECK — 정확히 하나만 존재.

---

## invoice_share_tokens — 공개 청구서 링크 (0046)

소유자가 클라이언트에게 보낸 청구서 링크. `signature_requests`와 같은 규칙 — 원문 토큰은 발송 순간에만 존재하고 DB엔 SHA-256 해시만 저장하므로 **재발송은 항상 재발급**(이전 토큰 `revoked`)이다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | uuid PK | 토큰 식별자 |
| `user_id` | uuid FK→auth.users | 인보이스 소유자 |
| `invoice_id` | uuid FK→invoices (ON DELETE CASCADE) | 대상 인보이스 |
| `token_hash` | text NOT NULL UNIQUE | 링크 토큰의 SHA-256 해시(32~128자 CHECK) |
| `recipient_email` | text NULL | 수신자. 클라이언트 이메일이 없으면 NULL(링크만 발급) |
| `status` | invoice_share_status, 기본 `active` | `(invoice_id) WHERE status='active'` partial unique로 인보이스당 활성 1건 |
| `expires_at` | timestamptz NOT NULL | 만료. 앱이 `due_date + 90일`(최소 now+30일, 상한 365일)로 계산. RPC는 400일 상한만 검증 |
| `first_viewed_at` | timestamptz | 클라이언트 최초 열람 시각(`get_invoice_view`가 기록) |
| `last_sent_at` | timestamptz | 마지막 발송 시각 |
| `created_at` | timestamptz | 생성 시각 |

> RLS는 소유자 SELECT 정책만 둔다. INSERT/UPDATE/DELETE 권한·정책 없음 — 쓰기는 `send_invoice_with_event()` DEFINER RPC 전용(0036 락다운 방침).

---

## anon_rate_limit_events — 비로그인 레이트리밋 (0018)

공개 서명 표면(anon RPC)용 IP 해시 기반 레이트리밋 카운터. 기존 `rate_limit_events`는 `user_id NOT NULL`이라 별도 테이블. RLS만 활성(정책 없음) — 접근은 `consume_anon_rate_limit()` DEFINER 함수로만.

---

## profiles — 사용자 프로필/설정

사용자별 기본 설정. `user_id`가 곧 PK(1:1).

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `user_id` | uuid PK, FK→auth.users | 사용자(= 식별자) |
| `display_name` | text | 표시 이름 |
| `default_withholding_type` | withholding_type, 기본 `none` | 인보이스 기본 원천징수 유형 |
| `bank_name` | text | 입금 은행명 |
| `bank_account_number` | text | 입금 계좌번호 |
| `bank_account_holder` | text | 예금주 |
| `created_at` / `updated_at` | timestamptz | 생성/수정 시각 |

---

## rate_limit_events — 로그인 사용자 레이트리밋 (0014)

비싼 AI 엔드포인트(계약서 초안·PDF 파싱·인사이트)의 사용자 단위 슬라이딩 윈도우 카운터. 서버리스 다중 인스턴스에서도 신뢰 가능하도록 공유 저장소(Postgres)에 둔다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | bigint identity PK | 이벤트 식별자 |
| `user_id` | uuid FK→auth.users (CASCADE) | 호출자 |
| `bucket` | text NOT NULL | 엔드포인트 구분(`RATE_LIMITS` 상수와 대응) |
| `created_at` | timestamptz | 호출 시각 |

> RLS는 본인 행 select/insert/delete(윈도우 밖 정리). 판정은 `consume_rate_limit(bucket, limit, window_seconds)`가 caller 권한으로 수행한다.

---

## subscriptions — 구독 (0024)

Polar 구독의 내부 투영. 사용자당 1행(`user_id`가 PK).

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `user_id` | uuid PK, FK→auth.users (CASCADE) | 구독자 |
| `plan` | text, 기본 `free` | `free` / `pro` (CHECK) |
| `status` | text, 기본 `inactive` | Polar status 투영(`active`·`trialing`·`past_due`·`canceled`·`revoked` 등) |
| `polar_customer_id` / `polar_subscription_id` | text | Polar 식별자(webhook 재처리 시 행 조회) |
| `current_period_end` | timestamptz | 현재 결제 주기 종료(만료 안전망) |
| `cancel_at_period_end` | boolean, 기본 false | 취소 예정(기간 잔여 동안 pro 유지) |
| `updated_at` | timestamptz | 갱신 시각 |

> **SELECT 본인 행만. INSERT/UPDATE/DELETE 정책 없음** = 클라이언트 직접 쓰기 전면 차단. 기록은 `upsert_subscription_from_polar`(DEFINER)로만. 유효 플랜 판정은 이 행 + 현재시각 → `derivePlan()`(`lib/plan.ts` 순수 함수)이며, SQL에서 같은 판정이 필요한 곳(`generate_due_recurring_invoices`)은 등가 조건을 인라인한다.

---

## billing_events — 구독 감사 로그 (0024)

`contract_events`/`invoice_events`와 같은 append-only 패턴. webhook이 처리한 구독 이벤트를 기록한다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | bigint identity PK | 이벤트 식별자 |
| `user_id` | uuid FK→auth.users (CASCADE) | 구독자 |
| `polar_subscription_id` | text | 대상 Polar 구독 |
| `event_type` | text NOT NULL | webhook 이벤트 종류 |
| `status` | text | 처리 후 상태 |
| `meta` | jsonb, 기본 `{}` | 원본 페이로드 요약 |
| `created_at` | timestamptz | 발생 시각 |

> SELECT 본인 행만. INSERT 정책 없음 = DEFINER RPC 내부에서만 기록.

---

## usage_counters — 무료 티어 누적 사용량 (0024)

버킷별 평생 누적 오도미터. pro는 소비하지 않으므로 무료 사용분만 쌓이고, 다운그레이드 후에도 "누적 N회" 의미가 유지된다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `user_id` | uuid FK→auth.users (CASCADE) | 사용자 (PK 1/2) |
| `bucket` | text | 상한 종류. 현재 `ai_import_parse`(불러오기 파싱) (PK 2/2) |
| `used` | integer, 기본 0 | 누적 소비량 |
| `updated_at` | timestamptz | 갱신 시각 |

> RLS는 본인 행 select/insert/update — `consume_lifetime_quota`가 caller 권한으로 돌며 RLS를 통과해야 하기 때문. "새 계약 생성·서명" 상한은 여기 쌓지 않고 `contracts` 실시간 count로 판정한다(ADR-010).

---

## billing_config / cron_config — 시크릿 단일 행 (0026·0027)

세션 없는 경계(Polar webhook·일일 크론)가 자신을 증명할 때 대조하는 시크릿. 두 테이블 구조·하드닝이 동일하다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | boolean PK, 기본 true, CHECK `id` | 단일 행 강제(`id = true`만 허용) |
| `webhook_secret` / `cron_secret` | text | **0041 이후 미사용**(항상 빈 문자열). 과거 평문 저장 컬럼 |
| `secret_sha256` | text | 대조용 시크릿의 sha256 hex(0041) — 평문은 저장하지 않는다 |
| `updated_at` | timestamptz | 갱신 시각 |

> **RLS 활성 + 정책 없음 + `revoke all from anon, authenticated`**(이중 방어) — 직접 조회 불가. `upsert_subscription_from_polar`·`assert_cron_secret` 같은 SECURITY DEFINER 함수만 읽는다. Supabase `postgres` 롤은 커스텀 GUC ALTER 권한이 없어 GUC 대신 테이블에 둔다.
>
> **0041부터 시크릿은 sha256 해시로만 보관한다**(DB 덤프가 유출돼도 경계를 바로 통과할 수 없다). 게이트 함수가 입력을 같은 방식으로 해시해 비교하므로 env 값(`CRON_SECRET`·`POLAR_WEBHOOK_SECRET`)은 그대로 둔다. 설정·교체는 **평문 UPDATE가 아니라 헬퍼 함수**로 한다(SQL Editor에서 postgres 롤로 실행, 16자 이상):
> ```sql
> select set_cron_secret('<CRON_SECRET과 동일값>');
> select set_billing_webhook_secret('<POLAR_WEBHOOK_SECRET과 동일값>');
> ```
> 0041 마이그레이션은 기존 평문을 그대로 해시해 옮기므로 재주입이 필요 없다(신규 환경에서만 위 명령 필요).

---

## dunning_reminders — 미수금 독촉 초안 (0028)

연체 인보이스마다 일일 크론이 만드는 독촉 메일 초안. **소유자가 앱에서 승인해야만** 클라이언트에게 실제로 발송된다(ADR-011).

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | uuid PK | 초안 식별자 |
| `user_id` | uuid FK→auth.users (CASCADE) | 소유자 |
| `invoice_id` | uuid FK→invoices (CASCADE) | 대상 인보이스 |
| `status` | text, 기본 `pending_review` | `pending_review` / `sent` / `dismissed` (CHECK) |
| `draft_subject` / `draft_body` | text | AI(또는 폴백) 초안. 크론 sweep이 채우고 소유자가 수정 가능 |
| `ai_source` | text | `ai` / `fallback` — 초안 출처 표기 |
| `sent_at` | timestamptz | 실제 발송 시각(승인 시) |
| `meta` | jsonb, 기본 `{}` | 부가 정보 |
| `created_at` | timestamptz | 생성 시각 |

> **INSERT/DELETE 정책 없음** = 초안 생성은 크론 DEFINER RPC 내부에서만. 소유자는 select + update(승인·무시)만 가능. 멱등성은 부분 유니크 `(invoice_id) WHERE status = 'pending_review'`로 강제 — 인보이스당 미검토 초안 1건.

---

## recurring_invoices — 반복 인보이스 스케줄 (0029)

매 주기 draft 인보이스를 자동 생성하는 스케줄. 스케줄 CRUD는 세션 있는 Server Action(RLS own), 인보이스 생성은 크론 RPC.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | uuid PK | 스케줄 식별자 |
| `user_id` | uuid FK→auth.users (CASCADE) | 소유자 |
| `contract_id` | uuid FK→contracts (CASCADE), nullable | 연결 계약(선택) |
| `client_id` | uuid FK→clients (CASCADE) | 청구 대상 |
| `amount` / `withholding_type` / `withholding_amount` / `net_amount` | bigint·enum | **스케줄 생성 시 `calcWithholding` 스냅샷**. 크론 RPC는 순수 복사만(SQL에 세금 로직 중복 금지) |
| `interval_kind` | text | `weekly` / `monthly` (CHECK) |
| `next_run_at` | date | 다음 생성 예정일. 생성 후 `computeNextRun`과 등가로 전진 |
| `due_offset_days` | integer, 기본 14 | 발행일 + N일 = 지급기한 |
| `active` | boolean, 기본 true | 일시중지 스위치 |
| `last_generated_at` | timestamptz | 마지막 생성 시각 |
| `meta` / `created_at` | jsonb / timestamptz | 부가 정보 / 생성 시각 |

> 소유자 select/insert/update/delete 정책 전부 존재(스케줄은 사용자 소유 설정). **다운그레이드 시 행을 지우지 않고**, 크론 RPC의 `plan = pro` 조건이 free 유저 스케줄을 건너뛰어 생성만 멈춘다.

---

## contract_insights — AI 계약 인사이트 (0030)

과거 계약을 Claude가 읽어 도출한 조항 약점/누락 피드백. 온디맨드(세션 있는 Pro API)에서만 생성되며 크론과 무관하다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | uuid PK | 인사이트 식별자 |
| `user_id` | uuid FK→auth.users (CASCADE) | 소유자 |
| `contract_id` | uuid FK→contracts (CASCADE) | 대상 계약 |
| `summary` | text NOT NULL | 한 줄 요약. 새 계약 초안 생성 시 `prior_insights`로 되먹임 |
| `risk_level` | text NOT NULL | `low` / `medium` / `high` (CHECK) |
| `findings` | jsonb, 기본 `[]` | `[{clause_title, severity, note}]` |
| `model` / `source` | text | 사용 모델 / `ai`·`fallback` |
| `meta` / `created_at` | jsonb / timestamptz | 부가 정보 / 생성 시각 |

> 소유자 select/insert만(update/delete 정책 없음 — 분석은 새 행으로 누적). 리포트의 "종합 계약 피드백 요약"은 이 행들을 `summarizeInsights()`(`lib/insights.ts` 순수 함수)로 집계한다. AI 결과는 **비법률자문·검토보조**.

---

## RLS (Row Level Security)

모든 사용자 데이터 테이블에 RLS를 활성화한다 — `clients`·`contracts`·`invoices`·`contract_events`·`invoice_events`·`profiles`·`signature_requests`·`contract_signatures`·`rate_limit_events`·`anon_rate_limit_events`·`subscriptions`·`billing_events`·`usage_counters`·`billing_config`·`cron_config`·`dunning_reminders`·`recurring_invoices`·`contract_insights`·`invoice_share_tokens`.

- **select/insert/update**: 기본은 `user_id = auth.uid()` 정책(`USING` + `WITH CHECK` 둘 다). 예외는 아래 표대로다.

| 테이블 | 정책 구성 | 이유 |
|--------|-----------|------|
| `contract_signatures` | select/insert만 | 불변 증거(되돌리기·삭제로 지워지지 않음) |
| `contract_insights` | select/insert만 | 분석은 수정 대신 새 행으로 누적 |
| `subscriptions`·`billing_events` | select만 | 쓰기는 webhook DEFINER RPC 전용 |
| `dunning_reminders` | select + update만 | 생성은 크론 DEFINER RPC 전용, 소유자는 승인/무시만 |
| `usage_counters`·`rate_limit_events` | 본인 행 CRUD | 소비 RPC가 caller 권한으로 돌아 RLS를 통과해야 함 |
| `anon_rate_limit_events`·`billing_config`·`cron_config` | **정책 없음**(+ grant 회수) | DEFINER 함수 전용. 어떤 롤도 직접 조회 불가 |

- **anon**: 어떤 테이블에도 anon 정책이 없다. 비로그인 서명자·webhook·크론은 SECURITY DEFINER RPC(§ 맞서명 함수 / § 결제·크론 함수) 경유로만 접근하며, 각 경계는 토큰 해시 또는 시크릿 대조로 fail-closed 인가한다(ADR-009·010·011).
- **delete**: 대부분 소프트 삭제만이라 삭제 정책 없음. 예외 (1) 데모 데이터는 `is_demo = true` 조건으로 삭제 허용(`*_delete_demo_own`), events의 데모 삭제는 상위 계약/인보이스가 `is_demo = true`인지 EXISTS로 확인. (2) **계약(contracts)은 물리 삭제**라 소유자 delete 정책 `contracts_delete_own`(상태·is_demo 무관, `contracts_delete_demo_own`은 이 정책의 부분집합이므로 제거). 계약 삭제 시 `contract_events`는 CASCADE, `invoices.contract_id`는 SET NULL로 DB가 처리(참조 액션은 RLS 우회).
- 서버 인가는 `getUser()` 사용, FK 참조(invoice→contract/client)는 Server Action에서 소유권 재조회 후 insert(FK는 RLS 우회하므로).

---

## Storage

`contract-artifacts` (private) 버킷 — 계약 PDF·서명 이미지 저장.
- public = false, 파일 크기 제한 5MB, 허용 MIME: `image/png`, `application/pdf`.
- 경로 규칙: `{user_id}/...` 첫 폴더가 소유자 uid.
- RLS: select/insert/update/delete 모두 `(storage.foldername(name))[1] = auth.uid()` 조건(delete는 `contract_artifacts_delete_own` — 계약 물리 삭제 시 서버가 아티팩트 제거). DB에는 key만 저장하고 읽기는 단기 signed URL로.

---

## 인덱스

| 인덱스 | 대상 | 목적 |
|--------|------|------|
| `idx_clients_active_user_id` | clients(user_id) WHERE deleted_at IS NULL | 활성 고객 목록 |
| `idx_contracts_active_user_id` | contracts(user_id) WHERE deleted_at IS NULL | 활성 계약 목록 |
| `idx_invoices_active_user_id` | invoices(user_id) WHERE deleted_at IS NULL | 활성 인보이스 목록 |
| `idx_invoices_unpaid_due_date` | invoices(user_id, due_date) WHERE payment_status = 'unpaid' | 미수/연체 조회 |
| `idx_contracts_user_client` | contracts(user_id, client_id) | 고객별 계약 |
| `idx_invoices_user_client` | invoices(user_id, client_id) | 고객별 인보이스 |
| `idx_contract_events_contract_created_at` | contract_events(contract_id, created_at) | 계약 이벤트 타임라인 |
| `idx_invoice_events_invoice_created_at` | invoice_events(invoice_id, created_at) | 인보이스 이벤트 타임라인 |
| `invoice_share_tokens_one_active_per_invoice` | invoice_share_tokens(invoice_id) WHERE status = 'active' (UNIQUE) | 인보이스당 활성 링크 1건 강제 |
| `invoice_share_tokens_owner_invoice` | invoice_share_tokens(user_id, invoice_id) | 소유자 UI의 발송 이력 조회 |
| `signature_requests_one_pending_per_contract` | signature_requests(contract_id) WHERE status = 'pending' (UNIQUE) | 계약당 대기 요청 1건 강제 |
| `signature_requests_owner_contract_created_at` | signature_requests(user_id, contract_id, created_at) | 계약별 요청 조회 |
| `contract_signatures_contract_signed_at` | contract_signatures(contract_id, signed_at) | 계약별 서명 열거 |
| `contract_signatures_one_counterparty_per_request` | contract_signatures(request_id) WHERE party = 'counterparty' (UNIQUE) | 요청당 상대 서명 1건 강제 |
| `anon_rate_limit_events_lookup` | anon_rate_limit_events(ip_hash, bucket, created_at) | 레이트리밋 윈도우 조회 |
| `rate_limit_events_lookup` | rate_limit_events(user_id, bucket, created_at) | 사용자 레이트리밋 윈도우 조회 |
| `subscriptions_polar_customer_id_idx` | subscriptions(polar_customer_id) | webhook 재처리 시 행 조회 |
| `billing_events_user_id_created_at_idx` | billing_events(user_id, created_at) | 구독 이벤트 타임라인 |
| `dunning_reminders_one_pending_idx` | dunning_reminders(invoice_id) WHERE status = 'pending_review' (UNIQUE) | 인보이스당 미검토 초안 1건(멱등) |
| `dunning_reminders_user_created_idx` / `dunning_reminders_invoice_idx` | dunning_reminders(user_id, created_at) / (invoice_id) | 검토 대기 목록·인보이스 상세 조회 |
| `recurring_invoices_due_idx` | recurring_invoices(next_run_at) WHERE active | 크론의 도래 스케줄 스캔 |
| `recurring_invoices_user_created_idx` | recurring_invoices(user_id, created_at) | 스케줄 목록 |
| `contract_insights_contract_created_idx` | contract_insights(contract_id, created_at DESC) | 계약별 최신 인사이트 |
| `contract_insights_user_created_idx` | contract_insights(user_id, created_at) | 리포트 종합 요약 집계 |

---

## 집계 함수 (SQL RPC)

집계는 JS가 아니라 SQL에서 수행한다. 모두 `stable` / `security invoker`(호출자 RLS 적용) / `search_path = public`. 연/월 경계는 KST 기준, `deleted_at IS NULL` 필터 적용.

**대시보드**
- `get_dashboard_totals()` → 6개 지표 반환: `outstanding_amount`(미수 총액, unpaid amount 합)·`outstanding_count`(미수 건수)·`monthly_revenue`(당월 입금 net_amount 합, KST 월)·`monthly_paid_count`(당월 입금 건수)·`expected_this_month_amount`(이번 달 지급기한 미입금 청구액)·`expected_this_month_count`(그 건수). (0011 마이그레이션에서 2→6 컬럼 확장)
- `get_dashboard_contract_pipeline()` → 계약 상태별 건수(초안/서명완료/진행중/완료, canceled 제외). (0011 신규)
- `get_dashboard_channel_revenue()` → 채널별 입금 net_amount 합.

**리포트(연 단위, `report_year` 인자)** — 입금 기준은 `paid_at`의 KST 연도, 미수 기준은 `issue_date` 연도.
- `get_report_tax_summary(year)` → 원천징수 유형별 건수·총액·원천징수액·실수령액(입금 기준).
- `get_report_channel_revenue(year)` → 채널별 net_amount 합 + 전체 합계(윈도우).
- `get_report_client_revenue(year)` → 고객별 net_amount 합 + 전체 합계(윈도우).
- `get_report_outstanding(year)` → 미수 건수/금액 + 연체 건수/금액(연체 = `due_date` < KST 오늘). 발행일 기준.
- `get_report_tax_ledger(year)` → 세무 정리용 인보이스 원장(입금일 오름차순, CSV 내보내기 전용).

---

## 도메인 뮤테이션 함수 (SQL RPC, 트랜잭션)

상태 전이·발행·서명·불러오기는 도메인 UPDATE/INSERT와 이벤트 로그 INSERT를 **단일 트랜잭션 함수**로 원자적으로 처리한다(부분 실패 방지, 대상 행 `for update` 락). Server Action이 소유권 검증 후 호출한다. (0012 마이그레이션)

- `transition_contract_status_with_event(...)` → 계약 status 전이 + `contract_events` 기록. `p_reset_signature_artifacts` 플래그로 signed→draft 되돌릴 때 서명 아티팩트(서명 이미지·doc_hash·signature_meta) 초기화. **to=draft & counterparty 서명 존재 시 raise**(0019, 앱 가드와 동일 규칙의 DB 이중 가드).
- `sign_contract_with_event(...)` → status=signed + doc_hash/signature_meta 기록 + 이벤트(`contract.signed`).
- `import_signed_contract_with_event(...)` → 불러온 계약을 서명 없이 signed로 삽입 + 이벤트(`contract.imported`). doc_hash는 원본 PDF 바이트 기준.
- `issue_invoice_with_event(...)` → 인보이스 발행(금액 스냅샷) + 이벤트.
- `set_invoice_payment_with_event(...)` → 결제 상태 토글(unpaid↔paid, paid_at/payment_method 처리) + 이벤트.

---

## 맞서명 함수 (SQL RPC, 0019·0020)

모두 `search_path = public, pg_temp` 고정, `revoke from public` 후 필요한 롤에만 grant. **anon grant 함수는 SECURITY DEFINER**로 RLS를 우회하는 유일한 경계라 반환 필드 최소화·입력 상한을 지킨다(ADR-009).

**authenticated (owner 발송 플로우)**
- `send_signature_request_with_event(...)` → draft→sent + owner 서명 기록(contracts flat 컬럼 + `contract_signatures`) + `signature_requests` INSERT + 이벤트(`signature_request.sent`), 원자적.
- `revoke_signature_request_with_event(...)` → pending 철회 + sent→draft + owner 서명 아티팩트 리셋 + 이벤트. DEFINER지만 함수 안에서 `auth.uid()` 소유 검증(contract_signatures 무DELETE 정책 때문에 INVOKER 불가).

**anon (비로그인 서명자, 전부 DEFINER)**
- `get_signing_session(p_token_hash)` → 상태별 최소 필드 jsonb(무효 null / 만료·철회 state만 / pending 계약 열람 필드 / completed 다운로드 필드). pending 유효 시 `first_viewed_at` 1회 기록 + 이벤트(`signature_request.viewed`).
- `complete_counterparty_signature_with_event(...)` → FOR UPDATE 잠금 → pending·미만료·contract=sent·doc_hash==frozen_doc_hash 검증 → counterparty 서명 INSERT + 요청 completed + sent→signed + 이벤트(`contract.counterparty_signed`), 단일 트랜잭션.
- `get_certificate_data(p_token_hash)` → 완결 계약의 완결증명서 데이터(교부용).
- `get_signed_contract_data(p_token_hash)` → 완결 계약의 PDF 렌더 데이터(owner 서명 이미지는 미반환, 메타만).
- `store_completion_tsa_token(p_token_hash, p_token)` → 완결 TSA 토큰 write-once 저장(커밋 후 best-effort).
- `consume_anon_rate_limit(ip_hash, bucket, limit, window_seconds)` → IP 해시 기반 윈도우 카운트, 초과 시 false(0018).

---

## 청구서 전달 함수 (SQL RPC, 0046)

맞서명의 공개 토큰 패턴을 청구 단계에 복제한 것. 같은 규칙(`search_path` 고정, `revoke from public`, 입력 상한, 최소 필드 반환)을 따른다.

**authenticated (owner 발송 플로우)**
- `send_invoice_with_event(p_invoice_id, p_token_hash, p_recipient_email, p_expires_at, p_actor, p_meta)` → 소유자 스코프 FOR UPDATE 잠금 → 기존 활성 토큰 revoke → 새 토큰 INSERT → **draft일 때만** unpaid 전이 + `invoice.issued` 이벤트, 원자적. 반환 `{issued: boolean}`. `paid` 인보이스는 예외. 이미 `unpaid`면 재발송으로 보고 토큰만 교체(전이·이벤트 없음).
  - 실제 도달 증거인 `invoice.sent`는 **이 트랜잭션에 넣지 않는다**. 메일 발송이 성공한 뒤 앱이 `append_invoice_event`(0036)로 따로 남긴다 — 커밋 시점에 미리 남기면 "보냈다고 기록됐는데 안 간" 상태가 증거로 굳는다.

**anon (비로그인 클라이언트, DEFINER)**
- `get_invoice_view(p_token_hash)` → 상태별 최소 필드 jsonb(무효 null / `expired` / `revoked` / `active` 시 금액·원천징수·기한·계약 제목·클라이언트명·발신자명·계좌·`invoice_id`). 최초 열람 시 `first_viewed_at` 1회 기록.
  - `user_id`는 반환하지 않는다. `invoice_id`는 반환한다 — PDF 문서번호가 인보이스 id라 클라이언트 사본과 소유자 사본의 번호가 같아야 대조가 되고, 소유자 라우트는 세션+RLS로 막히므로 id를 알아도 열람 권한이 생기지 않는다.

---

## 결제·크론 함수 (SQL RPC, 0024·0026~0031)

세션 없는 경계(Polar webhook·일일 크론)가 남의 행을 써야 하는 자리. `service_role`을 요청 경로에 두는 대신 **시크릿 인자를 받는 SECURITY DEFINER 함수**로 좁힌다. 모두 `search_path = public, pg_temp` 고정 + `revoke all from public` 후 필요한 롤에만 grant.

**결제(ADR-010)**
- `consume_lifetime_quota(p_bucket, p_max)` → **INVOKER**(caller 권한 + RLS). `used < max`면 1 증가 후 `allowed:true`, 도달했으면 증가 없이 `false`. 검사→증가가 한 트랜잭션이라 원자적. `authenticated`만 실행.
- `upsert_subscription_from_polar(p_webhook_secret, p_user_id, ...)` → **DEFINER**. 첫 줄에서 `billing_config.webhook_secret`과 대조해 불일치·미설정이면 `raise`(fail-closed). 통과 시 `subscriptions` upsert + `billing_events` INSERT. **anon 전용**(0025에서 `authenticated` 실행권 회수 — anon 전용 DEFINER 컨벤션 유지). 시크릿 저장소는 0026에서 GUC → `billing_config` 테이블로 이전.

**크론(ADR-011)** — 모두 첫 줄에서 `assert_cron_secret`을 통과해야 하며, 실패 시 예외로 호출 전체가 롤백된다.
- `assert_cron_secret(p_secret)` → DEFINER. `cron_config.cron_secret`과 대조, 미설정/불일치면 `raise 'unauthorized cron call'`. 보안이 시크릿 게이트에 있으므로 실행권 자체는 anon·authenticated 모두에 부여.
- `create_dunning_drafts_for_overdue(p_cron_secret, p_cooldown_days default 7)` → 연체 후보(`unpaid` + `due_date < current_date` + 미삭제 + 미검토 초안 없음 + cooldown 내 발송 이력 없음)에 `pending_review` placeholder를 만들고, sweep이 AI 초안·소유자 알림을 만들 때 필요한 조인 필드(고객명·이메일·계약 제목·실수령액·연체일수·소유자 이메일)를 반환. 소유자 이메일은 `auth.users.email`이 varchar라 `::text` 캐스팅 필요(0031에서 수정).
- `update_dunning_draft_body(p_cron_secret, p_reminder_id, p_subject, p_body, p_source)` → sweep이 만든 초안 본문을 `pending_review` 행에만 채운다.
- `generate_due_recurring_invoices(p_cron_secret)` → 오늘 도래한 활성 스케줄 중 **소유자 plan=pro**인 것만(SQL에 `derivePlan` 등가 조건 인라인: pro + `status <> 'revoked'` + 기간 유효) `draft` 인보이스 INSERT + `invoice_events` 기록 + `next_run_at` 전진(weekly=+7d, monthly=+1month 월말 클램프 — `computeNextRun`과 등가). 세금은 스케줄 스냅샷을 순수 복사한다. 반환은 sweep의 소유자 알림용(생성 인보이스 + 소유자 이메일).

> 두 시크릿(`POLAR_WEBHOOK_SECRET`·`CRON_SECRET`)은 **env와 DB 테이블에 같은 값으로 이중 주입**해야 한다. 한쪽만 설정하면 조용히 전부 거부된다(의도된 fail-closed).

---

## 트리거

`set_updated_at()` — `clients`·`contracts`·`invoices`·`profiles`의 UPDATE 시 `updated_at`을 `now()`로 갱신. events 테이블에는 없음.

`block_contract_delete_with_counterparty_signature()` — contracts BEFORE DELETE. counterparty 서명이 존재하면 raise(0018). 계약 물리 삭제(ADR-008)의 예외인 증거 보존 최후 방어선 — 앱 레이어(`deleteContract`) 사전 체크와 이중 가드(ADR-009).

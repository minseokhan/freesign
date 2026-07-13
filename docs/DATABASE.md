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
| `contract_status` | `draft`, `signed`, `active`, `done`, `canceled` | 계약 상태 |
| `withholding_type` | `wt_3_3`, `wt_8_8`, `none` | 원천징수 유형(사업소득 3.3% / 기타소득 8.8% / 없음) |
| `payment_status` | `draft`, `unpaid`, `paid` | 인보이스 결제 상태 |

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
| `contract_id` | uuid FK→contracts (ON DELETE RESTRICT) | 원 계약 |
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

> `amount`·`withholding_amount`·`net_amount`(금액 스냅샷), `payment_status`·`paid_at`은 서버 소유 필드.

---

## contract_events / invoice_events — 상태 전이 로그

상태 변경을 기록하는 append-only 감사 로그. 도메인 UPDATE 이후 이벤트 INSERT 순으로 기록된다(부분 실패 방지). 두 테이블은 참조 대상만 다르고 구조가 동일하다.

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | uuid PK | 이벤트 식별자 |
| `user_id` | uuid FK→auth.users | 소유 사용자 |
| `contract_id` / `invoice_id` | uuid FK | 대상 계약/인보이스 |
| `actor` | text NOT NULL | 상태를 바꾼 주체 |
| `from_status` | text | 이전 상태(최초 생성 시 NULL 가능) |
| `to_status` | text NOT NULL | 이후 상태 |
| `event_type` | text NOT NULL | 이벤트 종류 |
| `meta` | jsonb, 기본 `{}` | 부가 정보 |
| `created_at` | timestamptz | 발생 시각 |

> events 테이블은 append-only라 `updated_at`·`deleted_at`이 없다.

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

## RLS (Row Level Security)

`clients`·`contracts`·`invoices`·`contract_events`·`invoice_events`·`profiles` 모두 RLS 활성화.

- **select/insert/update**: 모든 테이블에 `user_id = auth.uid()` 정책(`USING` + `WITH CHECK` 둘 다).
- **delete**: 기본적으로 삭제 정책 없음(소프트 삭제만). 예외로 데모 데이터는 `is_demo = true` 조건으로 삭제 허용(`*_delete_demo_own`). events의 데모 삭제는 상위 계약/인보이스가 `is_demo = true`인지 EXISTS로 확인.
- 서버 인가는 `getUser()` 사용, FK 참조(invoice→contract/client)는 Server Action에서 소유권 재조회 후 insert(FK는 RLS 우회하므로).

---

## Storage

`contract-artifacts` (private) 버킷 — 계약 PDF·서명 이미지 저장.
- public = false, 파일 크기 제한 5MB, 허용 MIME: `image/png`, `application/pdf`.
- 경로 규칙: `{user_id}/...` 첫 폴더가 소유자 uid.
- RLS: select/insert/update 모두 `(storage.foldername(name))[1] = auth.uid()` 조건. DB에는 key만 저장하고 읽기는 단기 signed URL로.

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

---

## 집계 함수 (SQL RPC)

집계는 JS가 아니라 SQL에서 수행한다. 모두 `stable` / `security invoker`(호출자 RLS 적용) / `search_path = public`. 연/월 경계는 KST 기준, `deleted_at IS NULL` 필터 적용.

**대시보드**
- `get_dashboard_totals()` → `outstanding_amount`(미수 총액, unpaid의 amount 합), `monthly_revenue`(당월 입금 net_amount 합, KST 월 기준).
- `get_dashboard_channel_revenue()` → 채널별 입금 net_amount 합.

**리포트(연 단위, `report_year` 인자)** — 입금 기준은 `paid_at`의 KST 연도, 미수 기준은 `issue_date` 연도.
- `get_report_tax_summary(year)` → 원천징수 유형별 건수·총액·원천징수액·실수령액(입금 기준).
- `get_report_channel_revenue(year)` → 채널별 net_amount 합 + 전체 합계(윈도우).
- `get_report_client_revenue(year)` → 고객별 net_amount 합 + 전체 합계(윈도우).
- `get_report_outstanding(year)` → 미수 건수/금액 + 연체 건수/금액(연체 = `due_date` < KST 오늘). 발행일 기준.
- `get_report_tax_ledger(year)` → 세무 정리용 인보이스 원장(입금일 오름차순, CSV 내보내기 전용).

---

## 트리거

`set_updated_at()` — `clients`·`contracts`·`invoices`·`profiles`의 UPDATE 시 `updated_at`을 `now()`로 갱신. events 테이블에는 없음.

# 아키텍처

## 기술 스택
- **Next.js 15** (App Router, RSC + Server Actions) + **TypeScript strict**
- **Tailwind CSS + shadcn/ui**
- **Supabase**: Auth(Google OAuth) + Postgres + Storage. `@supabase/ssr`(쿠키 기반 서버/클라 클라이언트) + `middleware.ts` 토큰 갱신 + 생성 타입. 서버 인가는 `getUser()`(`getSession()` 아님). RLS로 `user_id` 스코프.
- **Claude API** (`@anthropic-ai/sdk`, tool-use/JSON) — 계약서 초안(문구 다듬기 + 평문 요약) 및 기존 계약 PDF 조항 추출
- **@react-pdf/renderer** — 계약서·인보이스 PDF. route `runtime='nodejs'` + `outputFileTracingIncludes`로 폰트/wasm 포함 + `maxDuration`. Pretendard 한글 전영역 임베드
- **폼·검증**: react-hook-form + **zod**(입력·jsonb·env 런타임 검증)
- **테스트**: Vitest(단위·통합) + Playwright(E2E) + GitHub Actions CI + Prettier / ESLint flat config
- **배포**: Vercel + Supabase 클라우드

## 디렉토리 구조
```
src/
├── app/
│   ├── (auth)/login          # Google 로그인
│   ├── (dashboard)/          # 인증 후: dashboard, clients, contracts, invoices, reports, settings
│   └── api/                  # 라우트 핸들러 — Claude·서명 해시·PDF·CSV·시크릿은 여기서만
├── components/               # shadcn/ui 기반 UI
├── types/                    # 도메인 타입 + Supabase 생성 타입
├── lib/
│   ├── supabase/             # 서버/클라이언트 Supabase 인스턴스
│   ├── tax.ts                # 원천징수 계산 (순수 함수)
│   └── metrics.ts            # 대시보드 집계 변환 (순수 함수)
└── services/
    ├── ai/                   # 계약서 초안 (Claude) — 템플릿 + 프롬프트 하이브리드
    ├── signature/            # SignatureProvider (v1 간이 → v2 실 API 교체)
    └── payment/              # PaymentProvider (v1 상태 관리 → v2 실 PG 교체)
```

## 페이지 구조 (IA)
```
/                     공개 랜딩(마케팅) — 인증 여부에 따라 CTA 분기 + 메뉴별 화면 갤러리
/login                로그인(Google)
/dashboard            미수금 합계·이달 수익·이번 달 예정 입금 KPI + 계약 파이프라인(단계별 건수) + 임박/지연 지급기한 + 채널 수익 TOP 위젯
/clients              클라이언트 목록(채널 태그 배지·필터)
/clients/[id]         클라이언트 상세 + 하위 계약 목록
/contracts            계약 목록
/contracts/new        AI 초안 생성 플로우(시나리오 A: 구조화 입력 → 초안 → 편집 → 확정)
/contracts/import     기존 계약 PDF 불러오기(시나리오 B: 업로드 → Claude 추출 → 검토 → 서명 없이 성사(signed) 저장, doc_hash는 원본 PDF 바이트로 산출)
/contracts/[id]       계약 상세 — 조항·평문요약·PDF·서명·하위 인보이스·이력 타임라인
/invoices             인보이스 목록(상태 필터)
/invoices/[id]        인보이스 상세 — 원천징수 내역·정산 상태 토글·PDF·상태 이력
/reports              채널별 수익 리포트 + 연도 필터 + CSV 내보내기
/settings             프로필·기본 원천징수율·계좌정보
/api/contracts/import/parse  업로드 PDF를 Claude로 파싱해 추출 결과 미리보기 반환(저장 없음, nodejs 런타임)
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
  status(enum: draft|signed|active|done|canceled),
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
```

### 데이터 모델 규칙
- **공통 컬럼**: 도메인 3테이블 모두 `is_demo`(데모 시드 표식), `deleted_at`(soft-delete), `updated_at`(트리거 자동 갱신).
- **RLS**: SELECT/UPDATE는 `USING`, **INSERT/UPDATE는 `WITH CHECK (user_id = (select auth.uid()))` 둘 다 명시**(없으면 타 user_id 삽입·소유권 이관 가능). `select` 래핑으로 플래너 캐싱. 이벤트 테이블은 select/insert만 허용(UPDATE/DELETE 정책 없음 = append-only).
- **DB CHECK 제약**: `amount > 0`, `0 <= withholding_amount <= amount`, `net_amount >= 0`, `due_date >= issue_date`.
- **`deleted_at IS NULL` 필터는 RLS가 아니라 공용 쿼리 헬퍼에서** — RLS에 넣으면 soft-delete 행이 복원·감사·세금 CSV에서 사라짐(soft-delete 목적과 충돌). FK는 `ON DELETE RESTRICT` + 앱 레이어에서 "비삭제 하위가 있으면 부모 삭제 차단".
- **하드삭제**: 실데이터 `paid` 인보이스는 하드삭제 금지. `is_demo=true`만 예외("데모 지우기"). 데모 삭제 Server Action은 **demo 이벤트를 먼저 삭제한 뒤 demo 도메인 행 삭제**(FK RESTRICT 충돌 방지). 실데이터 이벤트는 여전히 append-only. **예외: 계약(contracts)은 상태 무관 물리 삭제**(ADR-008 갱신) — `deleteContract` Server Action이 ① 딸린 인보이스에 계약 스냅샷(`contract_snapshot`) 기록(계약 살아있는 동안) → ② 계약 행 DELETE(DB가 `invoices.contract_id` SET NULL + `contract_events` CASCADE 동시 처리) → ③ Storage 아티팩트 best-effort 제거 순으로 수행. 스냅샷을 삭제 앞에, 파일 정리를 DB 삭제 뒤에 둬 부분 실패 시 데이터 유실을 막는다.
- **원천징수 계산**(`lib/tax.ts`): 소득세(원 미만 절사) + 지방소득세(10원 미만 절사) 분리. 발행 시점 스냅샷 저장(drift 방지), draft 동안만 재계산.
- **인덱스**: 부분 인덱스 `(user_id) WHERE deleted_at IS NULL`, `(user_id, due_date) WHERE payment_status='unpaid'`, `(user_id, client_id)`, 이벤트 테이블 `(contract_id/invoice_id, created_at)`.
- **집계**: 대시보드·리포트 지표는 **SQL 집계**(`SUM`/`GROUP BY`) + `lib/metrics.ts` 순수 변환/포맷. 별도 집계 테이블 없음. "이달 수익"은 입금일 기준 — SQL `date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul')`(UTC 저장을 JS로 집계하면 KST 9시간 밀림).

## 패턴 (렌더링·데이터 접근)
- **읽기**: RLS 스코프된 **Server Component에서 직접 Supabase 조회**. 읽기를 내부 `/api` fetch로 우회하지 않는다(안티패턴).
- **쓰기(뮤테이션)**: **Server Actions에서만**. `revalidatePath`로 갱신, 토글류는 `useOptimistic`.
- **시크릿·외부 API**(Claude·서명 해시·PDF·CSV): `app/api/` 라우트 핸들러 또는 서버 전용 모듈에서만. 클라이언트 컴포넌트 직접 호출 금지. Claude PDF 추출(`contract-import.ts`)도 서버 전용 모듈과 `/api/contracts/import/parse` 라우트에서만 호출한다.
- **인터랙션이 필요한 곳만 Client Component**(캔버스 서명·상태 토글·폼). 나머지는 RSC 기본.

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

**서명(부분 실패 최소화 순서)**
```
캔버스 PNG → route(/api/contracts/[id]/sign) → Storage 업로드(private, {user_id}/{contract_id}/)
          → doc_hash 산출 + IP/UA 메타(서버)
          → sign_contract_with_event RPC: status=signed UPDATE + signature_meta/doc_hash + 이벤트 INSERT를 원자적으로 처리
  ※ 업로드/해시를 RPC 앞에 두어, 실패 시 상태가 미완으로 남지 않게 한다.
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
- **contract.status**: `draft → signed → active → done`(각 전이 명시적 버튼, `active/done` 수동). `canceled`는 `done` 외 어디서든. 서명 후 조항 read-only — 편집하려면 `draft`로 되돌려 `signature_meta` 초기화·재서명(문서 해시 무결성).
- **invoice.payment_status**: `draft → unpaid(발행) → paid(입금)`. `paid → unpaid` 되돌리기 허용(`paid_at`/`payment_method` 초기화). `overdue`는 상태가 아니라 `unpaid && due_date<today` 파생.
- 모든 전이는 이벤트 로그에 append → 상세 화면 이력 타임라인으로 노출.

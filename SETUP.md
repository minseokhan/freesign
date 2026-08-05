# 매듭 — 실행·확인 가이드

Phase 0~9(계약 불러오기 포함) 개발이 끝난 시점에서 **직접 해줘야 할 설정**, **확인할 수 있는 것**, **웹 라우트별로 볼 수 있는 내용**을 정리한 문서입니다.

> 현재 상태: 전 phase 코드 완료. `lint`·`build`·`test`(Vitest 236개) green이고, **E2E(Playwright happy-path·smoke)도 dev 테스트 로그인으로 그린 통과**(정산 체인 전체 자동 검증). E2E는 라이브 Supabase + 테스트 계정이 있어야 로컬/CI에서 실제 구동됩니다.

---

## 1. 내가 해줘야 할 일 (셋업)

앱은 **Supabase(DB·인증·스토리지)**와 **Google OAuth**, 그리고 (선택) **Claude API**에 의존합니다. 이 외부 리소스는 코드로 만들 수 없어 직접 설정이 필요합니다.

### 1-1. 로컬 준비
```bash
npm install          # 의존성 설치
```

### 1-2. Supabase 프로젝트 만들기
1. https://supabase.com 에서 프로젝트 생성.
2. **Project Settings → API**에서 아래 3개 값 확보:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` 키 → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` 키 → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ **CLI 시드에서만** 사용. 앱 요청 경로에 절대 넣지 않음)

### 1-3. DB 마이그레이션 적용 (`supabase/migrations/0001~0012`)
스키마·RLS·인덱스·스토리지·대시보드/리포트 집계 함수·데모 삭제 정책·원본 PDF·계약 평문요약·대시보드 확장·도메인 뮤테이션 함수가 들어있습니다. **순서대로 전부** 적용해야 합니다.

**방법 A — Supabase CLI (권장)**
```bash
npx supabase login
npx supabase link --project-ref <project-ref>   # URL의 <project-ref>.supabase.co
npx supabase db push                            # 0001~0012 순차 적용
```
**방법 B — SQL 에디터**: Supabase 대시보드 → SQL Editor에서 `0001_schema.sql`부터 `0012_...sql`까지 **번호 순서대로** 붙여넣어 실행.

> 적용 항목: 6개 테이블(clients·contracts·invoices·contract_events·invoice_events·profiles), RLS(`user_id` 스코프), 인덱스, private Storage 버킷, 대시보드/리포트 집계 함수(`.rpc()`), 데모 삭제 정책, 도메인 뮤테이션 트랜잭션 함수(`*_with_event`).

### 1-4. Google OAuth 설정
1. **Google Cloud Console** → OAuth 2.0 클라이언트 ID 생성(웹 애플리케이션).
   - 승인된 리디렉션 URI에 **Supabase 콜백** 추가: `https://<project-ref>.supabase.co/auth/v1/callback`
2. **Supabase 대시보드 → Authentication → Providers → Google** 활성화, 위에서 받은 Client ID/Secret 입력.
3. **Authentication → URL Configuration → Redirect URLs**에 앱 콜백 추가: `http://localhost:3000/auth/callback` (배포 시 실제 도메인도).

### 1-5. `.env.local` 작성
`.env.example`를 복사해 실제 값을 채웁니다.
```bash
cp .env.example .env.local
```

| 변수 | 용도 | 필수 여부 |
|------|------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 접속 | ✅ 필수 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저 클라이언트 | ✅ 필수 |
| `SUPABASE_SERVICE_ROLE_KEY` | CLI 시드 전용 | 시드 쓸 때만 |
| `ANTHROPIC_API_KEY` | AI 계약 초안(Claude) | ⚠️ 선택 — **없으면 AI 초안이 골격 템플릿으로 폴백**(기능은 안 막힘) |
| `NEXT_PUBLIC_SITE_URL` | OAuth 리다이렉트·PDF 절대경로 | ✅ 필수 (로컬 `http://localhost:3000`) |

### 1-6. (선택) DB 타입 재생성
스키마를 바꿨을 때만. 현재 커밋된 타입으로 그대로 동작합니다.
```bash
npm run db:gen-types
```

### 1-7. 실행
```bash
npm run dev          # http://localhost:3000
```

### 1-8. 첫 데이터 채우기 — **가장 쉬운 길: 앱 내 데모 버튼**
로그인 후 **대시보드의 "데모 데이터 채우기"** 버튼을 누르면 무디 샘플(클라이언트·계약·인보이스)이 내 계정으로 생성됩니다. 지울 때는 같은 자리의 "데모 데이터 지우기"(실데이터는 안 지워짐).

> CLI 시드(`npm run db:seed`)도 있지만 `DATABASE_URL`(또는 `SUPABASE_DB_URL`)와 `SEED_USER_ID`(내 auth 유저 id)가 필요해 번거롭습니다. **앱 내 버튼을 권장.**

---

## 2. 내가 확인할 수 있는 것 (검증)

### 2-1. 코드 품질 게이트 (외부 리소스 불필요 — 지금 바로 가능)
```bash
npm run lint         # ESLint
npm test             # Vitest 236개 (임베디드 Postgres로 RLS·집계까지 검증)
npm run build        # 프로덕션 빌드
```
`npm test`는 내장 Postgres를 자체 부팅하므로 **라이브 Supabase 없이도** 스키마·RLS 경계·세금 계산·집계 로직이 검증됩니다.

### 2-2. E2E (phase 8 step1 — 현재 blocked, 해제하려면)
실제 브라우저로 로그인~정산~리포트 해피패스를 돌리려면:
1. 라이브 Supabase에 **테스트 유저**를 하나 만든다(이메일/비번).
2. `.env.local`에 추가:
   ```
   ALLOW_TEST_LOGIN=true
   E2E_TEST_EMAIL=<테스트 유저 이메일>
   E2E_TEST_PASSWORD=<테스트 유저 비번>
   EMAIL_OUTBOX_FILE=.e2e-outbox.jsonl
   ```
   `EMAIL_OUTBOX_FILE`을 켜면 메일이 실제로 나가지 않고 이 JSONL 파일에 쌓입니다. 상대방 서명 링크·공개 청구서 링크는 메일 본문에만 존재하므로(DB엔 해시만) E2E가 여기서 읽습니다. **이미 떠 있는 dev 서버에는 적용되지 않으니 재기동**하세요.
3. 실행:
   ```bash
   npx playwright install chromium   # 브라우저 바이너리
   npm run test:e2e                  # e2e/happy-path.spec.ts 구동
   ```
> `ALLOW_TEST_LOGIN`은 **개발 환경 전용**입니다(`NODE_ENV=production`이면 `/dev/test-login`이 404). 백도어 방지 이중 가드.

### 2-3. CI (GitHub Actions)
`.github/workflows/ci.yml`이 push/PR마다 `lint → build → test`를 자동 실행합니다. E2E 잡은 **GitHub 저장소 Secrets에 E2E 자격증명이 있을 때만** 돌아갑니다(없으면 skip). 필요한 Secrets: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`, `E2E_BASE_URL`.

---

## 3. 웹 라우트별로 볼 수 있는 내용

`npm run dev` 후 브라우저로 접속합니다. **로그인 안 하면 대부분 `/login`으로 리다이렉트**됩니다(`getUser()` 가드).

### 화면(페이지)
| 라우트 | 무엇을 확인 |
|--------|------------|
| `/` | 진입점 — 로그인 상태면 `/dashboard`, 아니면 `/login`으로 자동 리다이렉트 |
| `/login` | **Google 로그인** 버튼. OAuth 실패 시 안내 배너 |
| `/dashboard` | **핵심 화면.** KPI 카드(미수금 합계·이달 수익·이번 달 예정 입금, KST 기준 SQL 집계), **계약 파이프라인**(초안→서명완료→진행중→완료 단계별 건수), 임박/지연 인보이스 리스트, 채널 수익 TOP 위젯, **데모 데이터 채우기/지우기** 버튼, 데이터 0건 빈 상태 |
| `/clients` | 클라이언트 목록, 채널 배지·필터 |
| `/clients/new` | 클라이언트 생성 폼(채널 select, zod 검증) |
| `/clients/[id]` | 클라이언트 상세, 수정/삭제(삭제 확인 UI) |
| `/clients/[id]/edit` | 클라이언트 수정 폼 |
| `/contracts` | 계약 목록, 상태 배지(draft/signed/active/done/canceled) |
| `/contracts/new` | **AI 계약 초안 생성** — 구조화 입력 → Claude 초안(키 없으면 골격 폴백), 스텝 인디케이터, **AI 면책 배너** |
| `/contracts/[id]` | 계약 상세 — 조항+평문요약 카드, 상태 배지, **이력 타임라인**, 상태 전이 버튼, **캔버스 서명**, **PDF 다운로드** |
| `/contracts/[id]/edit` | 조항 편집·확정(서명 전까지) |
| `/invoices` | 인보이스 목록(상태 필터: unpaid/paid) |
| `/invoices/new` | 인보이스 발행 — 계약 선택, **원천징수 스냅샷**(발행 시점 고정) |
| `/invoices/[id]` | 인보이스 상세 — 원천징수 내역·입금 계좌, **정산 토글**(unpaid↔paid, 낙관적 UI), **PDF 다운로드** |
| `/reports` | **채널별 수익 리포트** — 연도 필터, 입금 기준(paid_at·KST), **Excel 내보내기** |
| `/settings` | (준비 중 플레이스홀더 — 프로필·기본 원천징수율은 이후 연결) |
| `/dev/test-login` | **개발 전용** E2E 테스트 로그인(프로덕션 404) |

### API 라우트(직접 방문보다 앱에서 호출됨)
| 라우트 | 역할 |
|--------|------|
| `GET /auth/callback` | Google OAuth 콜백(code→세션 교환) |
| `POST /api/contracts/draft` | AI 초안 생성 |
| `POST /api/contracts/import/parse` | 업로드한 기존 계약 PDF를 Claude로 파싱해 조항·금액·기간 추출 미리보기(저장 없음) |
| `POST /api/contracts/[id]/sign` | 서명 처리(Storage 업로드·해시·상태전이) |
| `GET /api/contracts/[id]/pdf` | 계약 PDF(한글 임베드) |
| `GET /api/contracts/[id]/source-pdf` | 불러온 계약의 원본 PDF signed URL 반환 |
| `GET /api/invoices/[id]/pdf` | 인보이스 PDF |
| `GET /api/reports?year=YYYY` | 세무 원장 xlsx(서버 생성, write-excel-file) |

---

## 4. 추천 체험 순서 (핵심 데이터 흐름 한 바퀴)

매듭의 방어 코어는 **"계약 → 지급기한 → 입금/미수 증빙"** 체인입니다. 아래 순서로 3분이면 전체 흐름을 봅니다.

1. `/login` → Google 로그인
2. `/dashboard` → **"데모 데이터 채우기"** (또는 아래를 수동으로)
3. `/clients/new` → 클라이언트 생성
4. `/contracts/new` → AI 초안으로 계약 생성 → `/contracts/[id]`에서 조항 확정 → **서명** → PDF 확인
5. `/invoices/new` → 그 계약으로 인보이스 발행(원천징수 자동 계산) → `/invoices/[id]`에서 **정산 토글(paid)**
6. `/dashboard` → 방금 정산이 **이달 수익 KPI**에, 미발행/미수가 **미수금**에 반영되는지 확인
7. `/reports` → 채널별 수익 확인 후 **Excel 내보내기**

---

## 5. 자주 막히는 지점

- **로그인 후 바로 로그아웃/에러** → Supabase Redirect URL에 `http://localhost:3000/auth/callback`이 등록됐는지, `NEXT_PUBLIC_SITE_URL`이 맞는지 확인.
- **AI 초안이 밋밋함** → `ANTHROPIC_API_KEY` 미설정 시 정상(골격 템플릿 폴백). 키를 넣으면 Claude 초안 생성.
- **대시보드 KPI가 비어있음** → 데모 데이터를 채웠는지, 정산(paid) 처리한 인보이스가 이달(KST)에 있는지 확인.
- **`npm test`만 통과하고 앱은 안 뜸** → 테스트는 임베디드 DB라 라이브 Supabase 설정과 무관. 앱 구동은 `.env.local`이 필수.
- **PDF가 안 열림** → PDF는 Node 런타임 전용. 개발 서버(`npm run dev`)에서 확인.

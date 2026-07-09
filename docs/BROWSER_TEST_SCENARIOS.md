# FreeSign 브라우저 테스트 시나리오 (Playbook)

> `SCENARIO.md`("김하나의 하루")를 **재현 가능한 브라우저 테스트 절차**로 옮긴 문서.
> 매 회차 브라우저 테스팅 시 이 문서의 시나리오·기대결과를 기준으로 확인한다.
> 도구: `agent-browser`(openclaw-agent-browser 스킬) + 로컬 dev 서버.
> 최초 실측: 2026-07-09 (아래 "검증 상태"는 그 시점 기록 — 회귀 여부는 매회 갱신).

---

## 0. 사전 준비 (Setup)

### 0-1. dev 서버
```bash
npm run dev            # http://localhost:3000
# CSS 404·미적용 등 이상 시: 서버 종료 → rm -rf .next → 재기동
```
> 오래 떠 있던 dev 서버가 `.next` 스테일로 CSS를 404 서빙하는 사례 있음. 증상: 로고가 거대하게 렌더되고 레이아웃 무너짐. → **재기동으로 해결**.

### 0-2. 테스트 로그인 (Google OAuth 우회)
로그인은 Google OAuth 전용이라 자동화 불가 → 개발 전용 `/dev/test-login` 사용.

`.env.local`에 추가(개발 환경 한정, `NODE_ENV=production`이면 라우트 404):
```
ALLOW_TEST_LOGIN=true
E2E_TEST_EMAIL=e2e-test@freesign.local
E2E_TEST_PASSWORD=TestPass123!
```

**전용 테스트 유저**(실제 Google 계정과 분리, 데이터 오염 방지):
- email: `e2e-test@freesign.local` / password: `TestPass123!`
- Supabase auth에 수동 생성됨(이메일 provider). 재생성이 필요하면 아래 "부록: 테스트 유저 생성" 참조.

### 0-3. agent-browser
```bash
bash ~/.claude/skills/openclaw-agent-browser/scripts/setup.sh   # 최초 1회
agent-browser open http://localhost:3000/dev/test-login         # 인증 → /dashboard 리다이렉트
agent-browser state save auth.json                              # 세션 저장(재사용)
# 이후 세션: agent-browser state load auth.json
```

---

## ⚠️ 자동화 주의사항 (반드시 숙지)

1. **`agent-browser open` 직후 반드시 `snapshot -i`를 먼저 호출**해야 `@e1` 같은 ref가 등록된다. 안 그러면 `Unknown ref` 발생.
2. **텍스트·숫자·select 입력**: `agent-browser fill @ref "값"` (Playwright — React onChange 정상 발생).
3. **native `<input type="date">` 입력**: `fill`·키보드 타이핑·`type` 모두 ko 로케일 세그먼트에 값이 안 들어간다(빈 값). **eval + 네이티브 setter**로만 입력 가능:
   ```bash
   agent-browser eval "(() => { const S=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; const d={start_date:'2026-07-10',end_date:'2026-07-31',due_date:'2026-08-14'}; document.querySelectorAll('input[type=date]').forEach(e=>{if(d[e.name]){S.call(e,d[e.name]);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}}); return 'ok'; })()"
   ```
   단, textarea/number를 **eval로 넣으면 RHF 미동기화로 검증 실패**한다. → **텍스트·숫자는 `fill`, 날짜만 eval** 조합을 쓸 것.
4. **날짜 피커 버튼("날짜 선택도구 표시")**은 native OS 캘린더 → DOM 자동화 불가.
5. **PDF/CSV 다운로드**는 링크 클릭 대신 쿠키를 넘겨 endpoint를 직접 curl로 검증하는 게 확실하다:
   ```bash
   COOKIE=$(agent-browser eval "document.cookie" | tr -d '"')
   curl -s -D - -o out.pdf -H "Cookie: $COOKIE" "http://localhost:3000/api/..."
   ```
6. **server action 실행 여부**는 dev 서버 로그의 `POST /<route>`로 확인(예: `POST /clients/new`, `POST /contracts/new`).
7. **⚠️ `agent-browser click`은 `<form>` 밖의 `type="button" onClick={...}` 버튼(예: 계약 "초안 저장")의 React onClick을 트리거하지 못하는 경우가 있다**(무반응·무오류). 이럴 땐 native DOM 클릭으로 우회:
   ```bash
   agent-browser eval "[...document.querySelectorAll('button')].find(b=>/초안 저장/.test(b.innerText))?.click()"
   ```
   실제 사용자 클릭(=native click)에선 정상 동작하므로 **제품 버그가 아니라 도구 한계**다. form 내부 `type="submit"` 버튼은 `agent-browser click`으로 정상 동작.
8. 새로 저장된 draft 계약은 `/contracts`의 **"초안" 상태 필터 탭** 아래에 있다(기본 목록엔 안 보일 수 있음).

---

## 데모 데이터 (기준 시드)

대시보드 빈 화면의 **"데모 데이터 채우기"** 버튼으로 시딩(server action, service_role 불필요 — RLS 스코프). 시드 내용:
- 클라이언트 **무디** (채널: 인스타그램, hello@moodi.example)
- 계약 **무디 브랜드 리뉴얼** (₩3,000,000, 상태: 서명완료 — 단 서명 이미지는 없음, 상태만 시드)
- 인보이스 (₩3,000,000, 입금완료, **원천징수 ₩99,000 / 실지급 ₩2,901,000**, 발행 2026.07.22, 지급기한 2026.08.05, 입금일 2026.08.05)

> "데모 데이터 지우기"로 초기화 가능.

---

## 시나리오

각 시나리오: **경로 → 절차 → 기대결과**. `[검증]` = 2026-07-09 실측 결과.

### S1. 공개 랜딩 → 로그인 진입 (인증 불필요)
- **경로**: `/` → `/login`
- **절차**: 랜딩 로드 → CTA("무료로 시작하기")·"로그인" 클릭 → `/login`
- **기대**: 헤더 로고(`h-7`)·hero·기능 섹션·대시보드 프리뷰 카드 렌더. `/login`에 "Google로 계속하기" 버튼.
- `[검증]` ✅ 통과.

### S2. test-login 인증 + 대시보드 + 데모 온보딩 (인증)
- **경로**: `/dev/test-login` → `/dashboard`
- **절차**: 인증 리다이렉트 확인 → 빈 대시보드 "데모 데이터 채우기" 클릭
- **기대**: 빈 상태에 "데모 데이터 채우기" 버튼 → 클릭 후 미수금/이달수익/임박·지연/채널수익 카드 렌더, "데모 데이터 지우기"로 전환.
- `[검증]` ✅ 통과. 채널 수익 TOP = 인스타그램 ₩2,901,000.

### S3. 새 클라이언트 등록 (인증)
- **경로**: `/clients/new` → `/clients`
- **절차**: 이름·채널(select)·이메일·전화·메모 입력 → 저장
- **기대**: 저장 후 목록 리다이렉트, 신규 클라이언트가 채널과 함께 노출. 채널 필터(전체/링크드인/인스타그램/유튜브/직거래/크몽/추천/기타).
- `[검증]` ✅ 통과 ("브랜드 무드" / 인스타그램 등록됨).

### S4. 계약 생성 + AI 초안 + 확정 (인증)
- **경로**: `/contracts/new`
- **절차**: 클라이언트 선택 → 업무범위(`fill`)·금액(`fill`)·시작/종료/지급기한(**eval**) → "초안 생성" → 검토 → "초안 저장"
- **기대**:
  - 초안 생성: 조항 + **평문요약** + 필수조항 누락 시 **[검토 필요]** 배지 + **"AI 초안·법적 자문 아님·전문가 검토 권장"** 면책. (ANTHROPIC_API_KEY 미설정 시 "AI를 사용할 수 없어 골격 초안" 폴백)
  - 초안 저장: `/contracts/{id}` 이동, 상태 draft.
- `[검증]` 초안 생성 ✅ (골격 폴백·면책·평문요약·[검토필요] 정상). 초안 저장 ✅ (native click 시 `POST /contracts/new 200` → `createContractDraft` ok → `/contracts/{id}` 이동, DB에 draft 생성 확인). **주의: `agent-browser click`으로는 저장 버튼이 무반응** → 위 자동화 주의사항 #7의 native click 우회 사용. (이 무반응을 초기엔 제품 버그로 오진했으나, 계측 로그로 native click 시 정상 저장됨을 확정 — 도구 아티팩트였음)

### S5. 서명 + 계약 PDF (인증)
- **경로**: `/contracts/{id}`
- **절차**: (서명 가능 상태 계약에서) 캔버스 서명 → 저장 → PDF
- **기대**: 서명 시 서명자·시각·문서 해시 기록. 상태 전이 append-only 이벤트. 계약 PDF 다운로드(한글 임베드).
- `[검증]` 서명완료 상세: **문서 해시**·서명완료 상태·append-only 이력·면책 표시 ✅. **계약 PDF** ✅ (`/api/contracts/{id}/pdf` → 200, application/pdf, 2p). **라이브 캔버스 서명은 미실행** — 데모 계약이 이미 서명완료라 서명 액션 미표시. S4에서 native click으로 새 draft 계약을 만들 수 있으므로, 그 draft에서 캔버스 서명 플로우 재검증 가능(다음 회차 TODO).

### S6. 인보이스 발행 + 원천징수 3.3% (인증)
- **경로**: `/invoices/new` (생성) / `/invoices/{id}` (확인)
- **절차**: 계약 선택 → 청구액 → 원천징수 3.3% 토글 → 지급기한(eval) → 저장 → PDF
- **기대**: 3.3% 선택 시 **원천징수·실지급 자동 표시**(예: 300만 → 99,000 / 2,901,000). "참고용 계산" 면책. 발행 시점 금액 스냅샷(재계산 안 함). 인보이스 PDF.
- `[검증]` 기존 데모 인보이스 상세로 검증: 청구 ₩3,000,000 / **원천징수 ₩99,000** / **실수령 ₩2,901,000** ✅, 참고용 면책·스냅샷 표기·append-only 이력 ✅. **인보이스 PDF** ✅ (`/api/invoices/{id}/pdf` → 200, 1p). 신규 인보이스 폼 생성은 미검증(날짜는 eval, 저장 버튼이 form 밖 `type=button`이면 S4처럼 native click 우회 필요할 수 있음 — 다음 회차 TODO).

### S7. 정산 추적: 입금완료 ↔ 미수 토글 (인증)
- **경로**: `/invoices/{id}`
- **절차**: "미수로 되돌리기" / "입금완료" 버튼 토글
- **기대**: 상태 전이 + **이력 타임라인에 append-only 이벤트**(paid→unpaid, unpaid→paid) 기록.
- `[검증]` ✅ 양방향 토글, 이벤트 체인 `paid → unpaid → paid` 기록 확인.

### S8. 대시보드 지표 반영 (인증)
- **경로**: `/dashboard`
- **절차**: 인보이스 상태 변경 후 대시보드 재로드
- **기대**: 미수금 합계·이달 수익·임박/지연 지급기한이 상태 반영. (이달 수익은 `paid_at`의 KST 입금월 기준, 발행일 아님)
- `[검증]` ✅ 미수 전환 시 미수금 합계 ₩0 → ₩3,000,000 반영. 임박/지연은 지급기한이 7일 밖이면 미표시(정상).
- 참고: 데모 인보이스 입금일이 2026.08.05(당월 밖)라 "이달 수익 ₩0", 2026 연간 합계 ₩2,901,000 — **정합**(버그 아님).

### S9. 리포트 CSV 내보내기 (인증)
- **경로**: `/reports` → `/api/reports?year=YYYY`
- **절차**: 연도 필터 선택 → "CSV 내보내기"
- **기대**: 입금완료·해당 KST 연도 실지급액 합계. CSV 다운로드(UTF-8 BOM, 엑셀 한글 호환).
- `[검증]` ✅ `/api/reports?year=2026` → 200, `content-disposition: attachment; filename="freesign-report-2026.csv"`, `text/csv`. 내용: BOM + `채널,수익(원)` / `인스타그램,2901000`. 연도 탭 2026~2022.

---

## 알려진 이슈 (요약)

| ID | 이슈 | 심각도 | 상태 |
|----|------|--------|------|
| ~~BUG-1~~ | ~~"초안 저장" 무반응~~ → **오진(제품 버그 아님)**. `agent-browser click`이 form 밖 `type=button` onClick을 못 트리거한 도구 아티팩트. native click 시 정상 저장 | - | 해소(도구 한계로 재분류) |
| ENV-1 | dev 서버 스테일 시 CSS 404 → 재기동 필요 | 낮음 | 워크어라운드 |
| TEST-1 | native date 입력은 `fill`/타이핑 불가 → eval setter 필요 | - | 도구 한계(주의사항 #3) |
| TEST-2 | `agent-browser click`이 form 밖 `type=button onClick` 버튼을 못 누름 → native click 우회 | - | 도구 한계(주의사항 #7) |

---

## 부록: 테스트 유저 생성 (재생성 필요 시)

Supabase auth에 이메일/비번 유저 수동 생성. GoTrue가 토큰 컬럼을 문자열로 스캔하므로 `confirmation_token` 등을 `''`로 채워야 로그인 성공("Database error querying schema" 방지).

```sql
-- 1) 유저 + email identity 생성
with new_user as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
    'authenticated', 'authenticated', 'e2e-test@freesign.local',
    crypt('TestPass123!', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    false, false, false
  ) returning id, email
)
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
from new_user;

-- 2) GoTrue NULL 토큰 컬럼 방지
update auth.users set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  reauthentication_token = coalesce(reauthentication_token, '')
where email = 'e2e-test@freesign.local';
```

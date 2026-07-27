# FreeSign 브라우저 테스트 시나리오 (Playbook)

> `SCENARIO.md`("김하나의 하루")를 **재현 가능한 브라우저 테스트 절차**로 옮긴 문서.
> 매 회차 브라우저 테스팅 시 이 문서의 시나리오·기대결과를 기준으로 확인한다.
> 도구: 수동 검증은 `dev-browser` CLI(권장) 또는 `agent-browser`(openclaw-agent-browser 스킬) + 로컬 dev 서버.
> 최초 실측: 2026-07-09 (아래 "검증 상태"는 그 시점 기록 — 회귀 여부는 매회 갱신).
>
> **자동화**: S2~S9의 핵심 정산 체인(로그인→클라이언트→계약+AI초안→서명→인보이스+원천징수→입금→대시보드→리포트 CSV)은 `e2e/happy-path.spec.ts`(Playwright, `npm run test:e2e`)가 자동 커버한다. 이 스펙은 계약 제목 필수 입력, 저장 완료를 UUID URL로 대기(`/contracts/[0-9a-f-]{36}$`), 서명 캔버스 `scrollIntoViewIfNeeded`, CSV는 브라우저 인증 쿠키 공유(`page.request`)로 검증하며, 실제 Claude API 지연(~25초, 저장 시 재생성)을 감안해 `test.setTimeout(180s)`를 쓴다. 수동 플레이북은 이 자동 커버 밖의 시각·엣지 확인용으로 보완 사용.

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
- **절차**: **계약 제목**(`fill`, 필수·클라이언트 select 위) → 클라이언트 선택 → 업무범위(`fill`)·금액(`fill`)·시작/종료/지급기한(**eval**) → "초안 생성" → 검토 → "초안 저장"
- **기대**:
  - 초안 생성: 조항 + **평문요약** + 필수조항 누락 시 **[검토 필요]** 배지 + **"AI 초안·법적 자문 아님·전문가 검토 권장"** 면책. (ANTHROPIC_API_KEY 미설정 시 "AI를 사용할 수 없어 골격 초안" 폴백)
  - 초안 저장: `/contracts/{id}` 이동, 상태 draft.
  - 폼(2026-07-12 변경, **미검증**): 계약 제목 **필수**(빈 값 저장 불가). 금액 입력은 **천 단위 콤마 자동 표시**(예: `3,000,000` — `type=text`·`fill` 정상, 저장 시 콤마 제거된 숫자). "초안 생성" 후 **구조화 입력 박스가 숨겨지고** 생성된 초안이 상단에 바로 노출(스크롤 불필요). 저장 제목 = 입력한 제목(자동 "…초안" 접미어 없음).
- `[검증]` 초안 생성 ✅ (골격 폴백·면책·평문요약·[검토필요] 정상). 초안 저장 ✅ (native click 시 `POST /contracts/new 200` → `createContractDraft` ok → `/contracts/{id}` 이동, DB에 draft 생성 확인). **주의: `agent-browser click`으로는 저장 버튼이 무반응** → 위 자동화 주의사항 #7의 native click 우회 사용. (이 무반응을 초기엔 제품 버그로 오진했으나, 계측 로그로 native click 시 정상 저장됨을 확정 — 도구 아티팩트였음)

### S5. 서명 + 계약 PDF (인증)
- **경로**: `/contracts/{id}`
- **절차**: (서명 가능 상태 계약에서) 캔버스 서명 → 저장 → PDF
- **기대**: 서명 시 서명자·시각·문서 해시 기록. 상태 전이 append-only 이벤트. 계약 PDF 다운로드(한글 임베드).
- **캔버스 서명 자동화**: `agent-browser mouse move/down/up`으로 실제 획을 그린다(합성 PointerEvent는 `setPointerCapture`에서 throw). 캔버스 rect를 eval로 구해 중심 좌표에 드래그 → 그린 뒤 `canvas.getContext('2d').getImageData`로 non-blank 픽셀 확인. "서명 완료" 버튼은 form 밖 `type=button`이므로 **native click** 필요(#7).
  ```bash
  RECT=$(agent-browser eval "(()=>{const r=document.getElementById('signature-canvas').getBoundingClientRect();return Math.round(r.x)+' '+Math.round(r.y)+' '+Math.round(r.width)+' '+Math.round(r.height)})()" | tr -d '"'); read RX RY RW RH <<< "$RECT"; CY=$((RY+RH/2))
  agent-browser mouse move $((RX+80)) $CY; agent-browser mouse down
  for dx in 200 320 440 560; do agent-browser mouse move $((RX+dx)) $((CY-30)); done
  agent-browser mouse up
  agent-browser eval "[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='서명 완료')?.click()"
  ```
- `[검증]` ✅ **라이브 캔버스 서명 완료**: 새 draft 계약에 마우스 드래그로 서명 → `POST /api/contracts/{id}/sign 200` → 상태 draft→signed. DB 확인: `doc_hash`(SHA-256 64자), `signature_meta`={signer, ip, ua, signed_at} 기록(서버소유 필드). **draft→signed** append-only 이벤트. 서명 이미지가 화면에 렌더. **서명 PDF** ✅ (4p·43KB — 미서명 2p보다 서명 포함으로 증가). 서명완료 상세: 문서해시·서명자·서명시각·면책 표시.

### S6. 인보이스 발행 + 원천징수 3.3% (인증)
- **경로**: `/invoices/new` (생성) / `/invoices/{id}` (확인)
- **절차**: 계약 선택 → 청구액 → 원천징수 3.3% 토글 → 지급기한(eval) → 저장 → PDF
- **기대**: 3.3% 선택 시 **원천징수·실지급 자동 표시**(예: 300만 → 99,000 / 2,901,000). "참고용 계산" 면책. 발행 시점 금액 스냅샷(재계산 안 함). 인보이스 PDF.
- **신규 발행 진입**: 서명완료 계약 상세의 "인보이스 발행" 링크 → `/invoices/new?contract={id}` (계약에서 금액·발행일·지급기한 **프리필** → date 입력 이슈 없음, RHF defaultValues로 초기화). "발행" 버튼은 native click 권장(#7).
- `[검증]` ✅ **라이브 발행 완료**: 폼 실시간 미리보기 원천징수 ₩99,000 / 실수령 ₩2,901,000, "서버에서 재계산·발행시점 고정" 면책 → "발행" native click → `POST /invoices/new 200` → `/invoices/{id}`. DB 확인: `withholding_type=wt_3_3`, `withholding_amount=99000`, `net_amount=2901000`(서버 계산 스냅샷), `payment_status=unpaid`(신규 미수), `is_demo=false`, 계약 FK 연결. **인보이스 PDF** ✅ (`/api/invoices/{id}/pdf` → 200, 1p). 기존 데모 인보이스 상세도 동일 값 검증 완료.

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

### S9. 리포트 연 결산 + CSV 내보내기 (인증)
- **경로**: `/reports` → `/api/reports?year=YYYY`
- **절차**: 연도 필터 선택 → 4개 섹션 확인 → "CSV 내보내기"
- **기대**: 입금 기준으로 (1) KPI 카드(연간 입금 수익·총 원천징수·미수/연체), (2) 연간 세무 요약(원천징수 유형별 청구액·원천징수액·실지급액), (3) 채널별 수익, (4) 클라이언트별 수익 표, (5) 미수/연체 결산(발행 기준). CSV는 입금 인보이스 상세 원장.
- `[검증]` ✅ `/api/reports?year=2026` → 200, `content-disposition: attachment; filename="freesign-report-2026.csv"`, `text/csv`. 내용: BOM + `입금일,발행일,클라이언트,채널,청구액(원),원천징수유형,원천징수액(원),실지급액(원)` 헤더 + 인보이스별 행 + `합계` 행(청구 ₩5,000,000 / 원천징수 ₩165,000 / 실지급 ₩4,835,000). 연도 탭 2026~2022.

---

## Pro 3기능 시나리오 (2026-07-27 신규 · 미수금 독촉 · 반복 인보이스 · AI 계약 인사이트)

> 세 기능 모두 **Pro 게이트 + 크론 산출물**이다. 데이터 준비 → 크론 트리거 → UI에서 검토/발행 순으로 확인한다.
> 크론은 초안(pending_review/draft)만 만들고, **발송·발행은 항상 세션 있는 사람이** 한다(반자동 설계).
> `[검증]` = 크론/RPC/DB 레벨은 2026-07-26 실측 완료(엔드포인트 401/200·RPC 12 checks). **브라우저 UI 플로우는 미검증([검증 대기]).**

### P0. Pro 기능 사전 준비 (S10~S12 공통)

- **Pro 전환** (Supabase SQL Editor — 새 기능은 전부 Pro 전용):
  ```sql
  insert into subscriptions (user_id, plan, status)
  select id, 'pro', 'active' from auth.users where email = 'e2e-test@freesign.local'
  on conflict (user_id) do update set plan = 'pro', status = 'active';
  ```
  → free로 되돌릴 땐 `plan='free', status='canceled'`. Pro면 좌측 사이드바에 **"반복 인보이스"** 메뉴(proOnly)가 나타난다.
- **크론 수동 트리거** (독촉·반복 초안을 즉시 생성 — 매일 기다릴 필요 없음):
  ```bash
  curl -s -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2- | tr -d '\"'"'"')" \
    http://localhost:3000/api/cron/daily | python3 -m json.tool
  ```
  → `{"ok":true,"ran":{"dunning":{"ok":true,...},"recurring":{"ok":true,...}}}` 형태.
- **연체 인보이스 시드**(S11용): 인보이스를 발행한 뒤 지급기한을 과거로 —
  `update invoices set due_date = current_date - 5 where id = '<invoice_id>';` (클라이언트에 **이메일**이 있어야 발송 단계까지 확인 가능).

### S10. 반복(구독형) 인보이스 — Pro (인증)
- **경로**: 사이드바 "반복 인보이스" → `/invoices/recurring` → `/invoices/recurring/new`
- **절차**: "새 반복 스케줄" → 계약 선택·금액·원천징수·주기(매월)·**다음 생성일=오늘**·지급기한 일수 → "만들기" → 목록 복귀 → **크론 트리거(P0)** → 생성된 draft 인보이스 상세에서 "이 초안 발행"
- **기대**:
  - `/new` 폼에 **미리보기**(청구/원천징수/실수령, 참고용) + "서버에서 재계산" 면책. 0원·빈 금액은 제출 잠금.
  - 목록: 카드(활성 배지·실수령 스냅샷) + **상태 필터**(전체/활성/일시중지). 일시중지/재개, 삭제(ConfirmDialog "이미 생성된 인보이스는 유지").
  - 크론 후: `recurring: {generated:1}`, `/invoices`에 **draft** 인보이스 생성, 스케줄 "다음 생성일"이 다음 달로 전진. **멱등**: 재트리거 시 `generated:0`.
  - draft 상세: **"이 초안 발행"** → draft→unpaid + 이력 "발행". (발행 전 draft는 결제토글 대신 발행 버튼만 노출.)
- `[검증]` 크론/RPC/멱등/next_run 전진 ✅(2026-07-26 embedded-pg + 로컬 200). 브라우저 UI `[검증 대기]`.

### S11. 미수금 자동 독촉 — Pro (인증)
- **경로**: (연체 인보이스 시드 후) `/invoices/{id}`
- **절차**: 연체 인보이스 준비(P0) → **크론 트리거** → 인보이스 상세의 "독촉 초안 검토" 패널에서 본문 수정 → "이 내용으로 발송"
- **기대**:
  - 크론 후: `dunning: {candidates:1, drafted:1}`, dev 서버 로그에 소유자 알림 메일(`[email:console]` — Resend 미인증 시 콘솔).
  - 상세 상단 **"독촉 초안 검토"** 패널(제목·본문 textarea, "검토 대기" 배지, AI/기본 템플릿 표기). 수정 후 발송 시 "보냈습니다" + 이력 `dunning_sent`.
  - **멱등**: 재트리거 시 같은 인보이스 초안 재생성 안 됨(`candidates:0`). "무시"로 dismiss도 확인.
  - ⚠️ 클라이언트 **실제 발송**은 Resend `EMAIL_FROM` 도메인 인증 필요(미인증이면 발송 실패 메시지가 정상 — 소유자 알림은 무관). free면 패널 대신 UpgradeCard.
- `[검증]` cron 게이트·RPC 멱등/쿨다운 ✅. 브라우저 UI·이메일 발송 `[검증 대기]`.

### S12. AI 계약 인사이트 — Pro (인증)
- **경로**: `/contracts/{id}` → `/reports`
- **절차**: 계약 상세 "AI 인사이트 분석" 클릭 → 저장 → 새 계약 초안 생성으로 반영 확인 → 리포트 요약 확인
- **기대**:
  - 상세 "AI 계약 인사이트" 카드: 위험도 배지(낮음/보통/높음) + 요약 + 조항별 findings. ANTHROPIC 키 정상 시 AI, 실패 시 "기본 안내" 폴백이지만 **저장은 됨**. 새로고침 시 최신 인사이트 프리필. free는 402 → 업그레이드 CTA.
  - **새 draft 반영**: 인사이트 1건+ 저장 후 새 계약 AI 초안이 과거 위험 조항을 반영(골격 유지). free는 인사이트 없어 미반영(자연스러움).
  - **리포트**(`/reports`) 하단 "종합 계약 피드백 요약": 위험도 분포 카운트 + "자주 지적된 조항" 목록. free면 UpgradeCard.
  - 레이트리밋: 짧은 시간 반복 분석 시 429.
- `[검증]` API 402/200·레이트리밋·폴백 단위테스트 ✅. 브라우저 UI·실제 AI 응답 `[검증 대기]`.

---

## 2026-07-12 UI/UX 변경 회귀 체크리스트 (코드 변경 기준 · 브라우저 미검증)

> 이번 회차는 코드 레벨 변경(유닛/타입/린트 통과)만 완료했고 **브라우저 실측은 아직**이다.
> 다음 브라우저 테스팅 회차에 아래 항목을 확인하고 `[검증]`으로 승격할 것.

- **C1 계약 생성 폼(`/contracts/new`)** — `[검증]` ✅ 2026-07-14 `e2e/happy-path.spec.ts`가 자동 커버(계약 제목 필수 입력, 금액 천단위 콤마 `toHaveValue("3,000,000")`).
  - 클라이언트 select **위에 "계약 제목" 입력**이 있고 **필수**다(빈 값 저장 시 실패).
  - "계약 금액" 입력이 **천 단위 콤마**로 표시된다(placeholder `3,000,000`). 저장 값은 콤마 없는 정수.
  - "초안 생성" 클릭 후 **구조화 입력 카드가 사라지고** 생성된 초안이 바로 위에 노출(스크롤 없이 확인 가능). "다시 입력"으로 복귀.
- **C2 계약 상세 기본 정보(`/contracts/{id}`)**
  - 제목에 **"초안" 접미어 미표시**(상태는 배지로 구분).
  - 기본 정보에 **금액·기간만** 한 줄, **"PDF 저장" 필드 제거됨**.
  - **문서 해시는 전체 폭 아래 줄**에 모노스페이스·줄바꿈(`break-all`)으로 표시(더 이상 겹치지 않음).
- **C3 다음 단계 섹션**
  - 버튼이 2열에서 **시계방향**으로 배치: **진행 시작 → 인보이스 발행 → 계약 취소 → 초안으로 되돌리기**.
  - **취소(canceled) 계약**은 "인보이스 발행" 버튼 **미표시**(다음 단계 없으면 "진행할 수 있는 작업이 없습니다").
- **C4 계약 상태 전이 규칙 변경**
  - **진행중(active) → 초안(draft) 되돌리기 불가.** active 상세에는 "초안으로 되돌리기" 버튼이 **없어야** 한다.
  - 서명완료(signed) → 초안 되돌리기는 **여전히 허용**(작업 시작 전 수정용, 서명 아티팩트 리셋).
- **C5 이력 타임라인**
  - 영문 enum(`draft -> signed`) 대신 **한글 라벨 + 화살표**(예: `초안 → 서명완료`, `서명완료 → 진행중`)로 표시.
- **C6 레이아웃 고정(sticky)**
  - 스크롤 시 **좌측 사이드바**와 **상단 헤더("정산 워크스페이스")**가 뷰포트 상단에 고정된다.
- **C7 계약 불러오기 검토 폼(`/contracts/import`)**
  - 빈 값으로 "저장" 시 필드별 **영어 zod 메시지("Invalid input" 등) 미표시**. 대신 상단 **"입력값을 확인해 주세요"** + 해당 입력 **빨간 테두리**만 노출.
  - (참고) 조항 누락 시의 한글 안내 블록("필수 조항이 누락되었습니다: …")은 유지.

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

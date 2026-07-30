# 보안 수정 계획 (OWASP Top 10:2025 스캔 후속)

원본: `/owasp-scan` 확정 47건(critical 1 · high 13 · medium 18 · low 13 · info 2), 커밋 `2bb38bf` 기준.
대시보드: https://claude.ai/code/artifact/e7848743-9e2c-4289-bbc3-af21aa0dde2d

대시보드는 카테고리별로 같은 결함을 중복 계상한다(예: `usage_counters`가 A01·A06 양쪽). 아래는 **중복을 합친 실제 수정 단위**이며, 심각도 높은 순으로 배치를 나눈다. 배치마다 테스트·`build:verify` 게이트를 통과시키고 커밋한다.

## 완료 (커밋 335a314 · 마이그레이션 0032·0033)

| 대시보드 # | 심각도 | 항목 |
|---|---|---|
| 1 | Critical | `signature_requests` INSERT 정책 — 타 계약 서명요청 위조 |
| 2 | High | 토큰 anon DEFINER RPC 4종 소유자 불일치 미검증 |
| 3 | High | `contract_signatures`·`contract_events` 타인 계약 주입 |
| 4 · 21 | High | `usage_counters` 직접 UPDATE로 무료 쿼터 리셋 |
| 20 · 5 | High/Medium | `rate_limit_events` 삭제로 레이트리밋 우회 |

부분 완료(크로스 테넌트만 차단, 자기 계약 위조는 잔존) — 배치 2에서 마무리:
- **30** High `contract_signatures`에 소유자가 `party='counterparty'` 위조
- **36** High 감사 이벤트 로그 클라이언트 직접 INSERT(`invoice_events` 미착수)

## 배치 1 — High, 코드 국소 (완료 · 커밋 6a454c5)

| # | 심각도 | 항목 | 파일 |
|---|---|---|---|
| 9 | High | Next.js 15.5.20 → 15.5.22 (공개 취약점 8건) | `package.json` |
| 15 · 27 | High | posthog가 `$current_url`로 서명 토큰 전송 | `src/lib/analytics-sanitize.ts` |
| 35 · 16 | High/Medium | 이메일 콘솔 폴백이 원문 서명 토큰을 로그에 기록 | `src/services/email/provider.ts` |

## 배치 2 — High, DB 계층 (마이그레이션 0034·0035·0036)

| # | 심각도 | 항목 | 상태 |
|---|---|---|---|
| 22 | High | 독촉 크론 Pro 게이트 + 배치 상한(사용자당 20 · 실행당 200) | 완료 (0034) |
| 30 · 36 | High | 상태 전이 RPC DEFINER 전환 + 증거·감사 테이블 `revoke insert` | 완료 (0035·0036) |
| 23 · 45 | Medium | 폐기된 단독 서명 엔드포인트 제거(+`sign_contract_with_event` drop) | 완료 (0035) — 배치 3에서 앞당김 |
| 38 · 46 | Medium | 독촉 이벤트 INSERT 실패 무시 → RPC 전환하며 로깅 추가 | 완료 (0036) |
| 31 · 6 | High/Medium | `contracts`·`invoices` 컬럼 수준 UPDATE 권한 | **잔여** — 배치 2-b |

### 배치 2-b (다음)
`revoke update on contracts/invoices` + 도메인 컬럼만 `grant update(...)`. 선행 조건이던 RPC DEFINER 전환은 0035에서 끝났고, 남은 직접 쓰기 경로 2곳을 먼저 옮겨야 한다:
- `src/app/api/contracts/[id]/pdf/route.ts` → `contracts.contract_pdf_url`
- `src/app/(dashboard)/contracts/actions.ts` → 계약 삭제 시 `invoices.contract_snapshot`

함께 처리: 증거 테이블의 잔여 `UPDATE`/`DELETE` grant 회수(현재는 정책 부재로만 차단됨).

## 배치 3 — Medium

| # | 항목 |
|---|---|
| 7 | 크론 DEFINER RPC의 invoices→clients/contracts 테넌트 조인 |
| 17 | 완결 TSA 토큰이 anon 경계에서 무검증 주입·선점 |
| 19 | PDF 추출 텍스트의 2차 프롬프트 인젝션 |
| 28 | Supabase 세션 쿠키 HttpOnly·Secure |
| 32 | `is_demo` 클라이언트 쓰기 → 데모 삭제 정책 악용 |
| 37 | 크론 스윕 실패가 200 `ok:true`로 보고 |
| 41 · 42 · 43 · 44 | fail-open 게이트 · 발송 실패의 성공 처리 |
| 10 | jsDelivr 외부 CSS 버전 미고정 + SRI 부재 |

## 배치 4 — Low · Info

| # | 항목 |
|---|---|
| 8 | CSP가 `frame-ancestors`만 |
| 11 · 12 · 13 | sharp·postcss 취약점, CI 의존성 게이트 부재 |
| 18 · 29 | 크론·웹훅 시크릿 비상수시간 비교·평문 보관 |
| 24 · 47 | 레이트리밋·쿼터 fail-open |
| 25 · 26 | 공개 서명 조회 안티오토메이션, 독촉 발송 상한 |
| 33 | TSA 응답 messageImprint·nonce 미검증 |
| 39 · 40 | 인증 실패·레이트리밋 차단 무기록 |
| 14 · 34 | GitHub Actions SHA 핀, 분석 스크립트 SRI |

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
| 31 · 6 | High/Medium | `contracts`·`invoices` 컬럼 수준 UPDATE 권한 | 완료 (0037 · 커밋 6bbd47d) |

**여기까지 Critical 1건 + High 13건 전부 완료.** 커밋 335a314 · 6a454c5 · f6596f0 · 6bbd47d,
마이그레이션 0032~0037 원격(jbfxkcjeoqwcdsxuemug) 적용·검증 완료.

## 배치 3 — Medium (완료 · 커밋 c066f8c · 95483a1 · a25da19)

| # | 항목 | 처리 |
|---|---|---|
| 7 | 크론 DEFINER RPC의 invoices→clients/contracts 테넌트 조인 | 0038 (+ invoices·recurring_invoices 부모 소유권 WITH CHECK, 0034가 빠뜨린 `owner_email::text` 복구) |
| 32 | `is_demo` 클라이언트 쓰기 + INSERT 컬럼 제한 | 0039 (`seed_demo_data` DEFINER RPC로 데모 시드 이전, clients UPDATE 컬럼도 제한) |
| 17 | 완결 TSA 토큰 anon 무검증 주입·선점 | 0040 (2인자 버전 drop, `p_server_secret` 게이트) |
| 33 | TSA 응답 messageImprint·nonce 미검증 | `services/timestamp/provider.ts` TSTInfo 파싱·검증 + `TSA_URL` https 강제 |
| 19 | PDF 추출 텍스트의 2차 프롬프트 인젝션 | `<untrusted_reference>`·`<untrusted_contract>` 격리 + 개수·길이 상한 + 조항 4000자 zod |
| 28 | Supabase 세션 쿠키 HttpOnly·Secure | `lib/supabase/cookie-options.ts` 공용 상수(server·middleware 동일 값) |
| 37 | 크론 스윕 실패가 200 `ok:true`로 보고 | 실패 로깅·captureServerException·500 응답·401 로깅·maxDuration |
| 41 · 43 · 44 | fail-open 게이트 · 발송 실패의 성공 처리 | plan 게이트 fail-closed, 웹훅 throw→5xx, 재발송 토큰 롤백 |
| 42 | 콘솔 폴백이 항상 ok:true | 배치 1에서 처리됨(프로덕션 fail-closed provider) |
| 10 | jsDelivr 외부 CSS 버전 미고정 + SRI 부재 | `@v1.3.9` 핀 + sha384 SRI + crossorigin |

## 배치 4 — Low · Info (완료 · 커밋 a25827c · 256b5c3 · 6b88cbb)

| # | 항목 | 처리 |
|---|---|---|
| 45 | 라우트 핸들러의 Postgres 원본 에러 노출 | `lib/api-error.ts` `GENERIC_API_ERROR`로 12곳 교체 |
| 39 · 40 | 인증 실패·레이트리밋 차단 무기록 | 콜백 실패 로깅+캡처, 차단·fail-open 로깅(버킷 포함) |
| 26 | 독촉 발송 상한 부재 | `dunning_send` 5/60s 버킷 |
| 25 | 공개 서명 페이지 안티오토메이션 | `signing_session_view` 20/60s(IP 해시) |
| 29 · 18 | 시크릿 비상수시간 비교·평문 보관 | JS는 sha256+timingSafeEqual, DB는 0041 해시 저장 + `set_*_secret` 헬퍼 |
| 11 · 12 | sharp·postcss 취약점 | overrides로 sharp 0.35.3 · postcss 8.5.25 (`npm audit --omit=dev` 0건) |
| 13 | CI 의존성 게이트 부재 | CI `npm audit --audit-level=high --omit=dev` + `.github/dependabot.yml` |
| 14 | GitHub Actions SHA 핀 | checkout·setup-node·upload-artifact SHA 핀(+버전 주석) |
| 8 · 34 | CSP가 frame-ancestors만 | object-src·base-uri·form-action·style-src·font-src + Permissions-Policy 추가 |
| 24 · 47 | 레이트리밋·쿼터 fail-open | 과금 경계(`consumeImportQuota`)는 fail-closed 전환, 남용 방어는 fail-open 유지 + 로깅 |

### 남은 판단 항목(의도적으로 남김)

- **CSP `script-src` nonce** (#8·#34 잔여): Next 인라인 부트스트랩 때문에 middleware 요청별 nonce가 필요하고, 브라우저 실측 없이 켜면 앱이 통째로 깨질 수 있다. 별도 세션에서 dev-browser로 검증하며 도입할 것.
- **레이트리밋 fail-open 유지** (#24·#47): 남용 방어는 가용성 우선이라는 문서화된 트레이드오프를 유지했다. AI 버킷까지 fail-closed로 바꿀지는 제품 판단.
- **독촉 발송의 claim 재정렬** (#26 잔여): "발송 후 전이"를 "선점 후 발송"으로 바꾸면 중복 발송 위험은 줄지만 발송 성공/전이 실패 시 유실 위험이 생긴다. 현재는 레이트리밋으로 중복 폭주만 차단.
- **완결 TSA 다이제스트 동시 저장** (#17 잔여 제안): 사후 자동 재검증용 컬럼 추가는 스키마 변경이라 보류.

## 작업 방식 메모 (다음 세션용)

- **역검증 필수**: 새 회귀 테스트를 쓰면 해당 마이그레이션 파일을 잠깐 빼고 돌려 실제로 실패하는지 확인한다. 0032·0034에서 이 방식으로 테스트가 의미 있는지 확인했다.
- **테스트 하네스의 한계**: `src/test/pg.ts:124 grantSupabaseRoles()`가 마이그레이션 적용 후 모든 테이블 권한을 다시 부여한다. 즉 `revoke`(테이블·컬럼 권한)는 로컬 테스트로 검증 불가 — 원격에서 `information_schema.role_table_grants` / `column_privileges` 조회로 확인할 것.
- **원격 반영**: git 커밋만으로는 안 되고 `mcp__supabase__apply_migration`을 순서대로 호출해야 한다.
- **미확인 사항**: 0035~0041 적용 후 실제 서명 발송 → `/sign/{token}` 열람 → 완결 → PDF 교부 플로우를 브라우저로 한 번도 태우지 않았다. DEFINER 전환이 정상 경로에 미치는 영향은 SQL 테스트로만 확인된 상태다. 원격 적용 후 최우선 확인.
- **공유 DB 테스트 주의**: 임베디드 PG 하나를 모든 테스트 파일이 공유한다. 전 테넌트를 훑는 스윕(`create_dunning_drafts_for_overdue`·`generate_due_recurring_invoices`)을 부르는 테스트는 `pg_advisory_xact_lock(918273)`으로 직렬화하고, 픽스처는 트랜잭션+롤백으로 격리해야 간헐 실패가 없다(0038 테스트에서 실제로 겪음). `cron_config`도 단일 행 전역 상태라 값을 바꾸는 테스트는 금지(같은 값 재설정만).
- E2E(`npx playwright test`)는 **dev 서버 대상**으로만 동작한다 — `/dev/test-login`이 `NODE_ENV=production`에서 404다. dev 첫 컴파일이 느려 `--timeout=600000`을 주고, 서명 발송 Server Action은 외부 TSA·Resend 호출로 30초 가까이 걸린다(Resend 키는 403 상태).

## 배포 순서 (중요)

마이그레이션 0038~0041과 앱 코드는 서로 짝이다. 어느 쪽이든 혼자 먼저 나가면 데모 시드와
완결 TSA 저장이 잠깐 실패한다(둘 다 best-effort 경로라 치명적이진 않다).

1. `git push origin main` → Vercel 자동배포 완료 확인
2. `mcp__supabase__apply_migration`으로 **0038 → 0039 → 0040 → 0041 순서대로** 적용
3. 원격 검증: `information_schema.column_privileges`로 clients·contracts·invoices의
   INSERT/UPDATE 컬럼 목록 확인(`is_demo` 부재), `select pronargs from pg_proc where proname='store_completion_tsa_token'`(=3),
   `select cron_secret, secret_sha256 from cron_config`(평문 빈 값)
4. 브라우저로 서명 발송 → `/sign/{token}` 열람 → 완결 → PDF 교부 + 데모 시드/삭제 확인
   (0035~0041 전체를 통틀어 아직 한 번도 브라우저로 태우지 않았다)

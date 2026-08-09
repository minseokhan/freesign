# 보안 수정 후속 작업 (한민석님이 해야 하는 일)

작성: 2026-07-31 · 최종 갱신: 2026-07-31 (브라우저 검증·크론 검증·Dependabot 실측 반영)
관련 문서: `docs/archive/SECURITY_REMEDIATION_PLAN.md`(무엇을 왜 고쳤는지 정본), OWASP 대시보드 Artifact

---

## 0. 지금 상태 — 먼저 읽어주세요

OWASP 스캔 47건의 **코드 수정은 전부 끝났고 main에 push까지 됐습니다.** 테스트 749개·lint·`build:verify` 모두 그린입니다.

### 끝난 것

| 항목 | 결과 |
|---|---|
| 1·2절 — 원격 마이그레이션 0038~0041 | 순서대로 적용 완료, 검증 쿼리 5개 전부 기대값 일치 |
| 2-1절 — 권한 잔여분 0042~0044 | 세션 없는 경계 RPC 실행권 최소화 (`838d8cc`) |
| 5절 — CI | **한 번도 돈 적이 없었음**을 발견해 수정, 첫 그린 (`9cd482b`) |
| 4절 일부 — Polar 미구성 500 | 폴백으로 해소 (`6d36be2`) |
| 3절 — 브라우저 플로우 | **7단계 전부 통과.** 완결증명서에 완결 TSA 토큰까지 확인 (아래 3절) |
| 2절 말미 — 크론 실행 | 두 스윕 모두 `ok:true`. 0038이 고친 회귀 해소 확인 |
| 5절 — Dependabot | 8건 재실행해 **진짜 red/green 확보**: 그린 5 · 레드 3 (아래 5절) |

### 다음 세션에서 이어서 할 일 (우선순위 순)

1. **8/1 06:00(KST) 이후 Vercel 함수 로그에서 일일 크론 실제 실행 1회 확인** — 유일하게 남은 실행 항목입니다. 확인 절차는 2절 말미에 적어뒀습니다.
2. **Polar 프로덕션 전환** — [보류 결정 2026-07-31] 사업 판단이 설 때까지 미룹니다. 체크리스트는 4절에 그대로 둡니다.
3. **[추가 2026-08-03] 결제를 켜기 전 사업자 정보 기입** — `src/lib/legal.ts`의 `LEGAL` 상수가 전부 `[미기입]` placeholder입니다(상호·대표자·사업자등록번호·통신판매업 신고번호·주소·문의 이메일·개인정보 보호책임자·시행일 3종). 유료 구독을 열면 전자상거래법 제10조 표시의무 대상이 되므로 그 전에 반드시 채워야 합니다. `listUnfilledLegalFields()`가 미기입 필드를 돌려주고, `src/lib/__tests__/legal.test.ts`의 "[의도된 실패 예정]" 테스트가 채우는 순간 깨져 고지 문서 문구를 재확인하라고 알려줍니다. 관련: `docs/archive/LEGAL_ACCOUNT_PLAN.md` 7절.
4. **[완료 2026-08-03] 원격에 마이그레이션 `0047`·`0048` 적용 + 타입 반영** — 계정 삭제 경계(ADR-012). 순서상 **DB를 먼저** 적용했습니다(코드가 먼저 배포되면 아직 없는 `delete_own_account()`를 호출하게 됨). 적용 후 검증 4종 통과: `auth.users` 참조 FK가 CASCADE 16 / NO ACTION 0, 함수는 `SECURITY DEFINER`·무인자·`authenticated` 전용, `billing_records_retained`는 RLS 켜짐·정책 0건·`user_id` 컬럼 없음, 세션 없이 호출하면 fail-closed.

5. **[알려진 함정 2026-08-03] `npm run db:gen-types`는 컨테이너 런타임이 필요하다** — `supabase gen types`가 Docker/Podman을 요구하도록 바뀌어(`LegacyContainerRuntimeNotFoundError`) 이 머신에서는 실행되지 않습니다. 스크립트가 embedded-postgres에 로컬 마이그레이션을 적용한 뒤 CLI를 호출하는 구조라 원격 접속과는 무관하며, **Docker를 깔기 전까지는 `src/types/database.ts`를 손으로 갱신**해야 합니다. 값은 Supabase MCP `generate_typescript_types`(원격 스키마 기준)로 받아 대조하면 추측 없이 정확합니다. 단 MCP 출력은 신버전 생성기 형식(`Args: never`, `__InternalSupabase.PostgrestVersion`)이라 **통째로 덮어쓰면 안 됩니다** — 현재 파일은 구버전 형식(`Args: Record<PropertyKey, never>`)이고, 섞으면 무인자 RPC 호출 타입이 전부 바뀝니다. 필요한 항목만 기존 형식에 맞춰 추가할 것.

6. **[추가 2026-08-09] PR 리뷰 자동 승인 경로가 아직 한 번도 성공하지 못했습니다** — 심각도 게이트(`scripts/review-gate.mjs`)는 배포됐고 차단 경로(critical → `CHANGES_REQUESTED`)는 PR #16·#17에서 실증됐지만, **승인 경로는 GitHub 설정 때문에 422로 막혀 있습니다.** 지금도 `can_approve_pull_request_reviews: false`입니다(2026-08-09 확인). fail-closed라 위험은 없지만 "minor 이하는 자동 승인"이 실제로는 동작하지 않습니다.
   ```bash
   gh api -X PUT repos/{owner}/{repo}/actions/permissions/workflow -F can_approve_pull_request_reviews=true
   gh pr close 16 17 18   # 게이트 검증용 테스트 PR·브랜치 정리 (승인 재검증 후)
   ```
   배경과 실패 로그 분석은 `docs/archive/REVIEW_AUTOMATION_PLAN.md` §7.5.

7. **[추가 2026-08-09] `ci.yml`의 Playwright E2E 잡은 여전히 항상 스킵됩니다** — Actions 시크릿에 `ANTHROPIC_API_KEY`·`CLAUDE_CODE_OAUTH_TOKEN`만 있고 `E2E_TEST_EMAIL`·`E2E_TEST_PASSWORD`가 없습니다. fail-closed 패턴이라 조용히 스킵될 뿐 CI는 초록입니다 — **E2E가 CI에서 돈다고 믿으면 안 됩니다.**

> 재스캔 high 4건(6-1절)·6절 (1)~(4) 판단·`TSA_URL` 프로덕션 확정(4절)·배포 후 브라우저 확인(8절)은 전부 끝났습니다.
>
> 관찰 항목 하나: 레이트리밋 fail-open 로그(`[rate-limit] rpc error (fail-open)`)가 실제로 얼마나 찍히는지. 잦으면 6절 (2) 재검토 신호입니다.

> 왜 이런 순서가 됐나: 코드와 DB 권한이 한 쌍입니다. DB를 먼저 바꾸면 "예전 코드가 직접 INSERT하다가 권한 거부"로 깨지고, 코드를 먼저 배포하면 "새 코드가 아직 없는 함수를 호출"해서 깨집니다. 어느 쪽이든 몇 분짜리 창이 생기는데, 깨지는 범위가 더 좁은 쪽(코드 먼저)을 골랐습니다.

---

## 1. [완료 2026-07-31] 원격 마이그레이션 0038~0041 적용

### 왜 해야 하나

이번에 고친 보안 결함 중 **절반은 DB 안에 있습니다.** 코드만 배포하면 아래 구멍이 그대로 열려 있습니다.

- **0038** — 크론이 남의 데이터를 긁어오는 구멍. 공격자가 "내 인보이스인데 `client_id`는 피해자 것"인 행을 만들어두면, 매일 도는 독촉 크론이 RLS를 우회하는 함수로 조인해서 **피해자의 클라이언트 이름·계약 제목을 공격자 화면에 띄워줍니다.** 조인에 테넌트 조건을 넣고, 애초에 남의 `client_id`/`contract_id`를 참조하지 못하도록 정책도 함께 조입니다.
  - 보너스: 이 마이그레이션은 **지금 프로덕션에서 매일 실패 중인 독촉 크론도 고칩니다.** 0034가 0031의 타입 캐스팅(`u.email::text`)을 실수로 빠뜨려서, 원격에서는 독촉 스윕 전체가 에러로 죽고 있었습니다(응답이 항상 200 `ok:true`라 아무도 몰랐음 — 그 부분도 이번에 500으로 바꿨습니다).
- **0039** — `is_demo` 위조 구멍. `is_demo`는 "이 행은 데모니까 물리 삭제해도 된다"는 열쇠인데, 클라이언트가 마음대로 쓸 수 있었습니다. 실제 인보이스를 `is_demo=true`로 바꾼 뒤 **입금 이벤트 로그까지 흔적 없이 삭제**할 수 있었습니다. 이제 데모 생성은 서버 함수(`seed_demo_data`)만 할 수 있고, `is_demo`는 클라이언트 INSERT/UPDATE 권한에서 빠졌습니다.
- **0040** — 서명 완결 시각 증거 선점 구멍. 서명 링크를 가진 쪽이 완결 직후 **아무 값이나 먼저 밀어넣으면**(write-once라 먼저 쓴 값이 확정) 진짜 TSA 타임스탬프가 저장되지 못하고 가짜가 증명서에 박혔습니다. 이제 서버 시크릿을 아는 우리 서버만 저장할 수 있습니다.
- **0041** — 크론·웹훅 시크릿이 DB에 **평문**으로 들어 있었습니다. DB 덤프/백업이 한 번 새면 크론·결제 웹훅 경계를 바로 통과할 수 있습니다. 이제 sha256 해시만 저장합니다.

### 어떻게 했나

Supabase MCP `apply_migration`으로 0038 → 0039 → 0040 → 0041 순서대로 적용했습니다. 적용 전 `cron_config`·`billing_config`에 평문 시크릿이 **둘 다 남아 있어서**(64자·49자) 0041이 그대로 sha256으로 옮겼습니다 — 따라서 **시크릿 재입력은 불필요**했습니다.

(참고: 직접 하시려면) Supabase 대시보드 SQL Editor에 파일 내용을 **번호 순서대로** 붙여넣어 실행해도 됩니다. 순서가 중요합니다(0041이 0038~0040이 만든 함수를 다시 정의하지는 않지만, 0040은 0027의 게이트 함수를, 0041은 그 게이트 함수를 다시 씁니다).

| 파일 | 한 줄 요약 |
|---|---|
| `0038_cron_rpc_tenant_scope.sql` | 크론 함수 2개에 테넌트 조인 + 인보이스/반복 스케줄 정책에 부모 소유권 |
| `0039_demo_seed_rpc_insert_grants.sql` | `seed_demo_data()` 신설 + clients/contracts/invoices INSERT 컬럼 권한 축소 |
| `0040_completion_tsa_secret_gate.sql` | `store_completion_tsa_token`을 시크릿 게이트 3인자 버전으로 교체(2인자 drop) |
| `0041_secret_hash_storage.sql` | 크론·웹훅 시크릿을 sha256으로 저장 + `set_cron_secret`/`set_billing_webhook_secret` 헬퍼 |

### 실패하면

- **0039에서 "permission denied"** → SQL Editor는 `postgres` 롤로 실행되므로 정상적으로는 안 납니다. MCP로 적용해 보세요.
- **0041 적용 후 크론이 `unauthorized cron call`** → 저장된 평문이 비어 있었던 경우입니다. 아래 한 줄로 다시 넣으면 됩니다(값은 Vercel 환경변수 `CRON_SECRET`과 **똑같이**):
  ```sql
  select set_cron_secret('<CRON_SECRET과 동일한 값>');
  select set_billing_webhook_secret('<POLAR_WEBHOOK_SECRET과 동일한 값>');
  ```

---

## 2. [완료 2026-07-31] 적용 후 원격 검증

아래 쿼리 5개를 원격에서 실행해 **전부 기대값과 일치**함을 확인했습니다. `get_advisors(security)`도 돌렸고 ERROR 0건 · 새 회귀 없음이었습니다.

로컬 테스트로는 **권한 회수(revoke)를 검증할 수 없습니다.** 테스트 하네스가 마이그레이션 적용 후 모든 테이블 권한을 다시 부여하기 때문입니다(`src/test/pg.ts`의 `grantSupabaseRoles`). 그래서 원격에서 직접 확인해야 합니다.

```sql
-- (1) 클라이언트가 쓸 수 있는 컬럼 목록. is_demo·status·payment_status가 없어야 정상.
select table_name, privilege_type,
       string_agg(column_name, ', ' order by column_name) as columns
from information_schema.column_privileges
where grantee = 'authenticated'
  and table_schema = 'public'
  and table_name in ('clients', 'contracts', 'invoices')
group by 1, 2
order by 1, 2;
-- 기대: invoices는 UPDATE(deleted_at)만 있고 INSERT 행 자체가 없어야 함
--       contracts INSERT/UPDATE 목록에 status·doc_hash·signature_meta·is_demo 없음
--       clients   INSERT/UPDATE 목록에 is_demo 없음

-- (2) 무검증 TSA 저장 함수(2인자)가 사라졌는지
select proname, pronargs from pg_proc where proname = 'store_completion_tsa_token';
-- 기대: 3인자 한 줄만

-- (3) 새 함수들이 생겼는지
select proname from pg_proc
where proname in ('seed_demo_data', 'set_cron_secret', 'set_billing_webhook_secret');
-- 기대: 3개 모두

-- (4) 시크릿이 평문으로 남아 있지 않은지
select cron_secret = '' as plaintext_cleared, length(secret_sha256) as hash_len
from cron_config;
-- 기대: true, 64
select webhook_secret = '' as plaintext_cleared, length(secret_sha256) as hash_len
from billing_config;
-- 기대: true, 64

-- (5) 인보이스 정책에 부모 소유권 검사가 들어갔는지
select tablename, policyname, cmd from pg_policies
where tablename in ('invoices', 'recurring_invoices') order by 1, 3;
```

### [완료 2026-07-31] 크론 살아났는지 확인

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily
```

**결과**: `200 {"ok":true,"ran":{"dunning":{"ok":true,"candidates":0,"drafted":0,"ownersNotified":0},"recurring":{"ok":true,"generated":0,"ownersNotified":0}}}`

즉 **0038이 고친 회귀(스윕 자체가 에러로 죽던 문제)가 실제로 해소**됐습니다. `candidates:0`은 정상입니다 — 독촉은 Pro 전용이고 테스트 계정은 Free입니다.

두 가지를 정직하게 남깁니다.
- **호출 대상이 `localhost`입니다.** 시크릿을 외부로 내보내지 않으려고 로컬 dev 서버를 썼습니다. `.env.local`이 **원격 프로덕션 Supabase를 가리키므로 DB·RPC·데이터는 프로덕션과 동일**하고, 코드도 같은 커밋입니다. 검증되지 않은 것은 Vercel 인스턴스의 실행 환경뿐입니다.
- **Vercel의 실제 일일 실행은 아직 확인 못 했습니다.** 스케줄이 `0 21 * * *`(UTC) = KST 06:00이라, 마이그레이션 적용(7/31 오전) 이후 첫 실행은 **8/1 06:00**입니다. 런타임 로그 보존이 짧아 미리 볼 수 없습니다.

#### 8/1에 확인하는 방법 (둘 중 아무거나)

**a) Vercel 대시보드**
1. `https://vercel.com/hanminseoks-projects/freesign` 접속
2. 상단 탭에서 **Logs** (또는 좌측 **Observability → Logs**)
3. 검색창에 `/api/cron/daily` 입력, 기간을 **Last 24 hours**로
4. 확인할 것: **06:0x KST에 실행 1건**, 상태 **200**
   - **실패 신호**: 500이면 응답 본문에 어느 스윕이 죽었는지 나옵니다(`dunning` / `recurring`). 그 줄을 복사해 주세요.
   - 실행 자체가 **없으면** 크론이 안 걸린 것입니다 — `vercel.json`의 `crons` 설정과 프로덕션 배포 여부를 봐야 합니다.

**b) 터미널 (더 빠름)**
```bash
npx vercel logs freesign --since 12h | grep -i "cron/daily"
```

> 참고: 성공 응답은 `{"ok":true,"ran":{"dunning":{...},"recurring":{...}}}` 형태입니다. `candidates:0`·`generated:0`은 정상입니다(독촉은 Pro 전용, 현재 계정은 Free).

- (원래 기대값): `200` + `{"ok":true,"ran":{"dunning":{"ok":true,...},"recurring":{"ok":true,...}}}`
- 하나라도 실패하면 이제 **500**이 나옵니다(예전엔 실패해도 200이라 몰랐던 부분).
- 안전성: 이 호출은 독촉 **초안(pending_review)** 과 인보이스 **draft**만 만듭니다. 클라이언트에게 메일이 나가지 않습니다(발송은 앱에서 승인해야만).
- 참고: `CRON_SECRET`이 DB 해시와 **일치함은 이미 확인**했습니다(로컬 `.env.local` 값의 sha256 == 원격 `cron_config.secret_sha256`). 즉 게이트 통과는 보장되고, 이 curl은 0038이 고친 회귀(스윕 자체가 죽던 문제)가 실제로 살아났는지를 봅니다.

---

## 2-1. [완료 2026-07-31] 권한 잔여분 정리 (0042~0044)

0038~0041 적용 후 원격 `pg_proc.proacl`을 훑어 **세션 없는 경계 함수 전체**의 실행 권한을 점검했고, 남아 있던 구멍 3건을 회수했습니다. 커밋 `838d8cc`.

| 파일 | 회수 | 왜 |
|---|---|---|
| `0042_tsa_token_grant_cleanup.sql` | `store_completion_tsa_token`에서 `authenticated` | 0040이 만든 **새 함수**라 Supabase의 public 스키마 기본 권한(`ALTER DEFAULT PRIVILEGES`)이 자동으로 EXECUTE를 붙였다. `revoke all from public`으로는 지워지지 않는 직접 권한 |
| `0043_cron_gate_grant_cleanup.sql` | `assert_cron_secret`에서 `anon`+`authenticated` | 맞으면 void·틀리면 예외라 REST로 직접 부를 수 있으면 **부작용 없는 브루트포스 오라클**. 호출자 4개가 전부 DEFINER(owner=postgres)라 회수해도 게이트는 동작 |
| `0044_cron_rpc_authenticated_revoke.sql` | 크론 RPC 3개에서 `authenticated` | 0028·0029가 `to anon, authenticated`로 줬지만 호출자는 anon 클라이언트를 쓰는 일일 크론뿐 |

**최종 상태**: 세션 없는 경계 함수 10개가 전부 `anon=true, authenticated=false`, `assert_cron_secret`은 둘 다 `false`.

불변 검사는 `src/test/__tests__/sessionless-rpc-grants.test.ts` 한 곳에 모았습니다(함수 8개 × 두 롤). 0043·0044는 fail-first 확인 후 적용했고, 0042는 로컬에 Supabase 기본 권한 설정이 없어 재현되지 않아 **불변 잠금 역할**입니다.

> **정직하게 남기는 한계**: 0043으로 브루트포스 오라클이 사라지지는 **않았습니다.** 크론 RPC 자체는 anon에 열려 있어야 하고(ADR-011) 틀린 시크릿에 같은 예외를 돌려줍니다. 없앤 것은 "부작용도 연산 비용도 없는 가장 값싼 오라클"이고, 근본 방어는 여전히 `CRON_SECRET`의 엔트로피(현재 64자)입니다.

---

## 3. [거의 완료 2026-07-31] 브라우저로 실제 플로우 확인

`dev-browser` + 로컬 dev 서버(**원격 프로덕션 Supabase 연결**)로 태웠습니다. 테스트 계정은 `e2e-test@freesign.local`. 7단계 중 **6.5단계 통과**, 남은 것은 서명 완결 1건뿐입니다.

| 단계 | 결과 | 근거 |
|---|---|---|
| 1. 로그인·새로고침·로그아웃 | ✅ | `sb-...-auth-token`이 `httpOnly=true`, `document.cookie`에 **안 보임**. 새로고침 세션 유지, 로그아웃 후 쿠키 소멸 + `/dashboard` → `/login` 리다이렉트 |
| 2. 데모 채우기 → 지우기 | ✅ | 채우기 후 서명완료 1→2건, 지우기 후 2→1건. `seed_demo_data` RPC(0039)와 데모 삭제 정책 모두 동작 |
| 3. 클라이언트 생성·수정 | ✅ | 생성·수정 모두 성공. 0039의 컬럼 권한 축소가 정상 동작을 깨지 않음 |
| 4. 계약(AI 초안) → 인보이스 발행 → 입금 | ✅ | 계약 저장, 인보이스 발행(원천징수 99,000·실지급 2,901,000 스냅샷), 입금완료 전이 + **append-only 이벤트 2건 기록** 확인. `invoices` INSERT 직접 권한을 회수한 뒤에도 서버 경로로 정상 |
| 5. 서명 발송 | ✅ | 상태 `초안 → 서명 대기`, `doc_hash` 등록, **`sent_tsa_token` 저장됨**(발송 시점 TSA 정상) |
| 5. 서명 완결·완결증명서 | ✅ | 아래 "완결증명서 실측" |
| 6. 계약 물리 삭제 | ✅ | 삭제 후 인보이스 생존 + 제목이 `삭제된 계약: …`로 표시(`contract_snapshot` 유지) |
| 7. 서명 페이지 레이트리밋 | ✅ | 21번째 요청부터 "잠시 후 다시 시도해 주세요" (#25 정상) |

**추가로 확인된 것**
- 계약 PDF·인보이스 PDF 라우트 둘 다 `200 application/pdf`.
- 소유자 완결증명서 라우트(`/api/contracts/{id}/certificate`)가 **409**를 반환 — 500이 아닙니다. 이 라우트는 `getTimestampEnv()`를 409 판정보다 **먼저** 호출하므로(`route.ts:109`), 409가 나왔다는 건 **`TSA_URL`이 https zod 검사를 통과했다**는 뜻입니다. 단 이건 **로컬 env 기준**이고, Vercel의 Sensitive 값은 여전히 미확인입니다(4절).

### 완결증명서 실측 (2026-07-31 19:00)

자동화로는 못 했습니다. 서명 토큰은 **원문이 메일에만 있고 DB에는 sha256 해시만** 저장되고(설계상 정상), Resend 키는 **발송 전용(restricted)** 이라 메일을 읽을 수 없었으며, 행의 `token_hash`를 바꾸는 우회는 DB 쓰기 정책에 막혔습니다. 그래서 **한민석님이 직접 메일 링크로 서명을 완결**했고, 그 결과를 소유자 세션으로 확인했습니다.

`GET /api/contracts/{id}/certificate` → **200 · application/pdf · 25,677 bytes**. 본문 발췌:

```
제3자 타임스탬프 (RFC 3161)
TSA URL: https://freetsa.org/tsr
발송 시점 토큰: 확보 (지문 sha256 f671e904ed0dd011…33b37d09)
완결 시점 토큰: 확보 (지문 sha256 47632aae7153fcd4…133bc18b)

감사추적 타임라인
18:02:31  서명 요청 발송 · (소유자)
18:53:30  상대방 열람 · counterparty:hanms10171017@gmail.com
18:58:10  상대방 서명(완결) · counterparty:hanms10171017@gmail.com
```

확인된 것:
- **완결 시점 TSA 토큰이 저장됐다** → 0040(시크릿 게이트 3인자 버전)이 정상 동작. 게이트가 막혔다면 이 줄이 "없음"이었을 것입니다.
- 문서 해시가 발송 시점과 동일(`e9a1a1d7…baf8cf33`) → 발송 후 조항 동결이 유지됐다.
- 양측 서명자 정보·동의 항목·신원확인 수준(소유자는 "서비스 로그인 계정 확인", 상대방은 "이메일 링크 소유 확인")이 모두 기록됐다.
- 상태 `서명 대기 → 서명완료`, 삭제·초안 되돌리기 버튼이 사라지고 "계약 취소"만 남았다.

> 진행 중 나온 404는 제품 정상 동작이었습니다. 그 계약은 테스트 계정 소유라 실제 Google 계정 세션에서는 RLS가 걸러 404가 납니다. 직접 보려면 시크릿 창에서 `/dev/test-login`을 먼저 열면 됩니다.

**진행 시 주의 2가지**
- **결제/업그레이드 경로는 건너뛰세요.** Polar가 프로덕션에 미구성이라 지금은 "결제 준비 중" 안내로 빠집니다(4절).
- **서명 요청 메일은 본인 주소로** 보내세요. `EMAIL_FROM`이 미설정이라 발신자가 `매듭 <onboarding@resend.dev>`인데(`src/services/email/provider.ts:29`), Resend의 이 공용 도메인은 보통 계정 본인 주소로만 발송이 허용됩니다.

### 검증 중 만든 데이터 (테스트 계정 소유)

지워도 되고 두어도 됩니다. 단 **계약 하나는 서명 완결 검증용이라 지우면 위 절차를 못 합니다.**

- 클라이언트 `보안검증 클라이언트`
- 계약 `보안검증 계약 0731` (서명 대기) ← **남겨둘 것**
- 인보이스 2건: 위 계약의 ₩3,000,000(입금완료), 그리고 계약 물리삭제 검증에 쓴 고아 인보이스 1건(`삭제된 계약: 무디 브랜드 리뉴얼 1785421712678`)

> 자동화 메모: 데모 삭제 버튼과 계약 삭제는 각각 `window.confirm`과 확인 모달을 거칩니다. Playwright는 다이얼로그를 기본 취소하므로, 처음 "버튼이 안 먹는" 것처럼 보인 건 **제품 버그가 아니라 자동화 쪽 문제**였습니다.

---

## 4. [부분 완료] 환경변수 점검

### 확인된 것 (2026-07-31)

프로덕션 env 목록을 `vercel env ls`로 확인했습니다.

| 변수 | 상태 |
|---|---|
| `TSA_URL` | 존재(14일 전 등록). **값 확인 불가** — 아래 참고 |
| `RESEND_API_KEY` | 존재(11일 전) |
| `CRON_SECRET` | 존재(Preview+Production). **DB 해시와 일치 확인됨** |
| `POLAR_*` 4개 | **전부 없음** → 아래 별도 항목 |
| `EMAIL_FROM` | 없음 → 발신자가 `onboarding@resend.dev`로 폴백 |

`CRON_SECRET` 일치는 로컬 `.env.local` 값의 sha256이 원격 `cron_config.secret_sha256`과 같은지로 확인했습니다(값은 셸 안에서만 계산). 이게 중요한 이유: 0040 이후 **서명 완결 TSA 저장도 이 시크릿 게이트를 통과**해야 합니다. 즉 크론과 TSA 증거 저장이 둘 다 살아 있습니다.

### `TSA_URL` — 값을 읽을 수 없습니다 (Sensitive)

평문 TSA는 중간자가 가짜 타임스탬프를 증거로 심을 수 있어서 `https://`만 허용하도록 바꿨습니다(#33). `http://`로 시작하면 **완결증명서 PDF 라우트 2개가 500**입니다(`src/app/api/sign/[token]/certificate/route.ts:74`, `src/app/api/contracts/[id]/certificate/route.ts:109` — `getTimestampEnv()`가 try 밖이라 zod 예외가 그대로 500). 반면 **서명 완결 자체는 안 깨집니다**(`src/app/api/sign/[token]/route.ts:302`는 try/catch 안).

이 변수는 Vercel에 **Sensitive 타입**으로 등록돼 있어 대시보드에서도 `vercel env pull`로도 값을 읽을 수 없습니다(pull은 `[SENSITIVE]` 문자열을 돌려줍니다). 덮어쓰기만 가능합니다.

**[해결 2026-07-31] 값을 읽지 않고 판정됐습니다.** 프로덕션(`freesign.vercel.app`)에서 계약 `test`의 서명을 완결했더니 `signature_requests.completion_tsa_token`이 **저장**됐습니다. 토큰이 남으려면 `getTimestampEnv()`가 통과하고(= `.url()` + `startsWith("https://")`) TSA가 실제로 응답해야 합니다. `http://`였다면 zod가 던져 토큰이 `null`로 남았을 것이므로, **프로덕션 `TSA_URL`은 유효한 https**입니다. 덮어쓰기는 불필요합니다.

> 문서 초판의 "기본값 `https://freetsa.org/tsr`면 문제없습니다"는 오해 소지가 있어 정정합니다. **미설정 시 기본값이 자동 적용되지 않습니다.** `DEFAULT_PUBLIC_TSA_URL`은 문서화용 상수고, `TSA_URL`이 없으면 500이 아니라 **조용한 noop**(타임스탬프 없음)입니다 — `src/services/timestamp/provider.ts:17-19`.

### `RESEND_API_KEY` — 설정돼 있습니다

예전에는 키가 없어도 콘솔 폴백이 `ok:true`를 돌려줘서 "보낸 것처럼" 보였습니다(그리고 서명 토큰이 그대로 서버 로그에 찍혔습니다 — 배치 1에서 차단). 지금은 프로덕션에서 키가 없으면 발송이 정직하게 실패하고, **서명 재발송 버튼은 에러 메시지를 띄우며 토큰을 원래대로 되돌립니다**(#44).

키는 있으므로 남은 건 `EMAIL_FROM`뿐입니다 — 도메인 인증 후 설정하면 제3자 발송이 열립니다.

### Polar 미구성 — 500은 [완료], 프로덕션 전환은 [보류]

**발견**: `POLAR_ACCESS_TOKEN`·`POLAR_WEBHOOK_SECRET`·`POLAR_PRODUCT_ID`·`POLAR_SERVER`가 프로덕션에 전부 없어 `/api/billing/checkout`·`portal`이 `getPolarEnv()`의 필수 스키마에서 던지고 **500**이었습니다. `UpgradeCard`/`UpgradeButton`이 대시보드·리포트·인보이스 상세·반복 인보이스에 렌더되므로 **Free 사용자가 대시보드에서 바로 밟는 500**이었습니다.

**조치**(`6d36be2`): 미구성은 요청 오류가 아니라 배포 상태이므로, `isPolarConfigured()`로 먼저 판별해 `/billing?portal=not_configured`로 되돌리고 그 화면은 오류(`alert`)가 아니라 안내(`status`)로 렌더합니다. env를 채우면 이 분기는 자동으로 비활성화됩니다.

webhook 라우트는 손대지 않았습니다 — 시크릿이 빈 문자열이면 SDK 서명 검증에서 먼저 막혀 `applySubscriptionEvent`까지 도달하지 않습니다(이미 fail-closed).

**나중에 프로덕션 결제로 전환할 때 체크리스트**
1. Polar 대시보드에서 프로덕션 조직·상품·액세스 토큰·웹훅 엔드포인트(`https://maedeup.app/api/billing/webhook`) 생성
2. Vercel에 `POLAR_ACCESS_TOKEN`·`POLAR_WEBHOOK_SECRET`·`POLAR_PRODUCT_ID` 등록 + `POLAR_SERVER=production`
3. **DB 시크릿 교체** — `select set_billing_webhook_secret('<프로덕션 웹훅 시크릿>');`
   지금 원격 `billing_config`는 **로컬 sandbox 시크릿의 해시**를 들고 있습니다. 이 단계를 빠뜨리면 웹훅이 전부 `unauthorized billing webhook call`로 거부되고 **결제한 사용자가 Free로 남습니다.**
4. 재배포 후 실제 결제 1건으로 구독 행 생성 확인

> sandbox 값을 프로덕션에 그대로 넣는 선택지는 **택하지 않았습니다.** sandbox 체크아웃은 실제 청구가 없어 누구나 무료로 Pro를 받게 됩니다.

---

## 5. [완료] CI — 사실은 한 번도 돈 적이 없었습니다

이번에 CI에 **`npm audit --audit-level=high --omit=dev` 게이트**를 추가했습니다(프로덕션 의존성에 high 취약점이 있으면 빌드 실패).

이 문서는 원래 "지금은 0건이라 통과해야 합니다"라고 적었지만 **틀렸습니다.** 확인해 보니 CI는 최초 도입(`3bdf3d2`) 이후 **단 한 번도 성공한 적이 없었습니다.** 실행 이력이 전부 `0초 · 잡 0개`로 실패했는데, 원인은 e2e 잡의 job-level 조건이었습니다:

```yaml
if: ${{ secrets.E2E_TEST_EMAIL != '' && secrets.E2E_TEST_PASSWORD != '' }}
```

`jobs.<job_id>.if`에서 허용되는 컨텍스트는 `github`·`needs`·`vars`·`inputs`뿐이고 **`secrets`는 불가**입니다. 워크플로 검증 단계에서 거부되므로 잡이 아예 만들어지지 않고, 그래서 로그도 annotation도 남지 않아 아무도 눈치채지 못했습니다. 결과적으로 **공급망 게이트는 추가된 뒤 한 번도 실행되지 않았습니다.**

`9cd482b`에서 secrets를 읽을 수 있는 step `env`로 판정해 job output으로 넘기는 게이트 잡(`e2e-gate`)을 두고, e2e는 `needs`로 그 값을 받도록 고쳤습니다. **실행 `30606656779`이 첫 그린입니다** — audit·lint·build·테스트 737개가 전부 실제로 돌았고, E2E는 시크릿 미설정이라 의도대로 스킵됐습니다.

`.github/dependabot.yml`도 새로 넣었습니다(npm 주간 + GitHub Actions 월간). **PR이 오는 게 정상**입니다.

### [완료 2026-07-31] Dependabot 8건 재실행 — 진짜 red/green

열려 있던 PR 8건 전부에 `@dependabot rebase`를 걸어 **고쳐진 워크플로 위에서 다시 돌렸습니다.** 재실행 전에는 CI 체크가 PR에 **아예 붙지 않았고**(잡이 안 만들어지니 check run도 없음), Vercel 프리뷰 빌드만 보였습니다. 이제 lint·build·테스트·`npm audit`이 실제로 돕니다.

| PR | 대상 | 결과 | 판단 |
|---|---|---|---|
| #5 | minor-and-patch 그룹 14건 (react 19.2.8, @anthropic-ai/sdk 0.115.0, @supabase/ssr 0.12.3, posthog-js/node, react-hook-form 7.83 등) | 🟢 | **병합 권장** |
| #8 | `@testing-library/jest-dom` 6→7 (메이저) | 🟢 | **병합 권장** — devDependency, 테스트 전부 통과 |
| #4 | `actions/upload-artifact` 4→7 | 🟢 | **병합 권장** — CI 전용 |
| #3 | `actions/setup-node` 4→7 | 🟢 | **병합 권장** — CI 전용 |
| #2 | `actions/checkout` 4→7 | 🟢 | **병합 권장** — CI 전용 |
| #6 | `eslint` 9→10 | 🔴 | **닫기 권장.** `npm install`이 ERESOLVE로 실패 — `eslint-config-next@15.5.20`이 eslint 10을 peer로 받지 않음. Next가 지원할 때까지 우리가 할 수 있는 게 없음 |
| #7 | `@vitejs/plugin-react` 4→6 | 🔴 | **보류.** plugin-react 6은 vite 7을 요구, 현재 vite 5. vite 메이저 업그레이드가 선행돼야 함 |
| #9 | `tailwindcss` 3→4 | 🔴 | **별도 작업.** 빌드 실패 — v4는 PostCSS 플러그인이 `@tailwindcss/postcss`로 분리됨. 설정 마이그레이션이 필요한 진짜 작업이라 의존성 PR로 끝나지 않음 |

메이저 4건 중 실제로 깨진 건 3건이고, 셋 다 **우리 코드가 아니라 생태계 호환성** 문제입니다.

### [완료 2026-07-31] 처리 결과 — 8건 전부 정리

- **병합**: #5(minor-and-patch 14건) · #4 · #3 · #2 · #8(jest-dom 7 — rebase 후 초록 확인하고 병합).
- **닫음 #6**(eslint 10) — `eslint-config-next@15.5.20`이 peer로 받지 않습니다. Next가 지원하면 Dependabot이 다시 엽니다.
- **닫음 #7**(plugin-react 6) — **대안 조합으로 해결**했습니다. 6.x는 vite `^8`을 요구하는데 vitest 3.2.7은 vite `^5||^6||^7`까지만 받습니다. 대신 vite `^4~^7`을 모두 받는 **plugin-react 5.2.0 + vite 7.3.6**을 main에 직접 반영(`7ac4ede`). 문서 초판의 "vite 7이 필요"는 부정확했고 실제로는 vite 8이 필요했습니다.
- **닫음 #9**(tailwind 3→4) — 3.4 유지 결정. Dependabot ignore 규칙으로 메이저만 제외했습니다. 아래 참조.

**audit 변화**: 3건(vite high · esbuild moderate · brace-expansion high) → **1건**(brace-expansion). 남은 1건은 eslint 체인 경유라 eslint 10이 필요하고 그건 #6과 같은 이유로 막혀 있습니다. 전부 devDependency이고 `npm audit --omit=dev`는 **0건**이라 CI 게이트에는 영향이 없습니다.

> `npm audit fix`를 돌리면 취약 항목이 1건에서 9건으로 "늘어난 것처럼" 보입니다. 실제 취약 패키지는 `brace-expansion` 하나 그대로이고, 브레이킹 없이 고칠 수 없게 되자 npm이 그것을 의존하는 eslint 체인 전체를 나열하기 때문입니다. 놀라지 마세요.

### #9 (tailwind 3→4) — **[결정 2026-07-31] 3.4 유지, 닫음**

`.github/dependabot.yml`에 tailwindcss **메이저만** ignore 규칙을 넣고 PR을 닫았습니다(`3e75779`). 마이너·패치와 보안 업데이트는 계속 받습니다. 마이그레이션을 하기로 하면 그 항목만 지우면 PR이 다시 열립니다.

**미루는 근거**: npm에 `v3-lts: 3.4.19` 태그가 있고 3.4.18(2025-10)·3.4.19(2025-12)가 **v4 출시 이후** 릴리스라 3.4는 계속 유지됩니다. 보안 권고도 없습니다.

> 앞선 판단 중 하나를 정정합니다. "`tailwind-merge`도 v4용으로 올려야 한다"고 적었지만 **이미 3.6.0으로 v4용입니다.** 확인 없이 쓴 문장이었습니다. 즉 v4로 갈 때 걸림돌 하나는 이미 없습니다.

아래는 미룬 작업의 실제 규모입니다.

- `postcss.config.mjs`의 플러그인이 `@tailwindcss/postcss`로 분리되고, `globals.css`의 `@tailwind` 지시자가 `@import "tailwindcss"`로 바뀝니다.
- `tailwind.config.ts`(124줄)에 커스텀 색·간격 토큰이 있고, **`.tsx`에서 커스텀 간격 토큰 사용이 911곳**입니다. v4는 JS 설정을 `@config`로 계속 읽을 수 있어 한 번에 포팅할 필요는 없지만, 기본값 변경(테두리 색·ring 두께·`shadow-sm`→`shadow-xs` 등)이 화면에 그대로 드러납니다.
- 알려진 `cn()` 커스텀 간격 토큰 인식 문제를 같이 봐야 합니다(`tailwind-merge`는 이미 v4용 3.6.0이라 추가 업그레이드는 필요 없습니다).
- **지금 급하지 않은 이유**: tailwind 3.4.19에는 보안 권고가 없습니다. 테스트로는 시각 회귀를 못 잡으므로 브라우저 확인이 함께 필요한 작업입니다.

---

## 6. [판단 완료 2026-07-31] 제가 일부러 남긴 4가지

전부 "고칠 수는 있지만, 한민석님이 트레이드오프를 골라야 하는" 항목이었습니다. **네 건 모두 판단이 끝났습니다** — (1) 구현·배포, (2)(3) 현상 유지, (4) 불필요로 닫음.

### (1) CSP `script-src` nonce — **완료 (2026-07-31, `07cfbbd`)**

원래 "별도 세션에서 dev-browser로 검증하며 도입"으로 남겨둔 항목입니다. 이번에 브라우저가 붙어 있어서 실제로 넣고 실측까지 했고, 승인받아 커밋했습니다.

> 커밋 직전에 `x-nonce` 요청 헤더 설정 한 줄을 뺐습니다. 읽는 곳이 없었고, Next가 nonce를 붙일 때 보는 것은 `content-security-policy` 요청 헤더라 동작에 영향이 없습니다.

**보류 사유였던 비용이 이 앱에는 없었습니다.** Next 문서상 nonce는 전 페이지 동적 렌더링을 요구하고 정적 최적화·ISR·PPR이 꺼집니다. 그래서 성능 회귀를 걱정했는데, 빌드 라우트 표를 확인하니 **이미 전부 동적(`ƒ`)** 입니다. 정적(`○`)은 6개뿐이고 `/_not-found`·`/icon.png`·`/opengraph-image`·`/robots.txt`·`/sitemap.xml`·`/dev/pro-preview` — 전부 에셋이거나 dev 전용입니다. 랜딩 `/`도 원래 동적이었습니다. **잃을 정적 최적화가 없습니다.**

| 파일 | 변경 |
|---|---|
| `src/lib/csp.ts` (신규) | 정책 조립 + nonce 생성 |
| `src/middleware.ts` | 요청마다 nonce 생성 → **요청·응답 헤더 양쪽**에 CSP 설정 |
| `next.config.ts` | 정적 CSP 헤더 제거(이제 middleware 소유). 나머지 보안 헤더는 그대로 |
| `src/lib/__tests__/csp.test.ts` (신규) · `src/__tests__/middleware.test.ts` | 테스트 9개 추가 |

정책: `script-src 'self' 'nonce-<요청별>'` (dev만 `'unsafe-eval'` — webpack eval 소스맵). 나머지 지시자는 **한 글자도 안 바꿨습니다.**

- `'strict-dynamic'`은 **일부러 뺐습니다.** 넣으면 `'self'`가 무시돼 nonce가 안 붙은 청크 `<script src>` 하나만 있어도 화면이 통째로 죽습니다. `'self'`를 함께 두는 쪽이 방어력은 거의 같으면서(외부 호스트 주입·인라인 주입 모두 차단) 실패 모드가 훨씬 안전합니다.
- 요청 헤더에도 넣는 게 핵심입니다. Next는 **요청** 헤더의 CSP를 읽어 자기 인라인 스크립트에 nonce를 붙입니다. 응답에만 달면 정책만 걸리고 nonce가 안 붙어 앱이 죽습니다. 이걸 테스트로 잠갔습니다.

**실측 (dev + 로컬 프로덕션 빌드 둘 다)**

- dev 서버(`:3000`): 공개 3페이지 + 인증 8페이지 전부 CSP 위반 0건.
- **프로덕션 빌드**(`.next-verify` → `:3100`, `'unsafe-eval'` 없는 정책): 공개·인증 합쳐 12페이지 렌더 정상, 위반 0건, `pageerror` 0건. 서버 HTML의 스크립트 태그 19개 전부 nonce 부착 확인.
- **하이드레이션 실증**: `self.__next_f` 엔트리 23개(인라인 스크립트가 실제로 실행됐다는 뜻), `/settings`의 controlled input이 입력에 반응.
- 테스트 758개(+9)·lint 그린.

> 검증 중 한 번 "프로덕션에서 nonce가 하나도 안 붙었다"고 잘못 읽었습니다. 브라우저가 파싱 후 `nonce` **속성을 DOM에서 감추기** 때문이고(`getAttribute("nonce")`는 빈 문자열, `el.nonce` 프로퍼티는 정상), 서버 HTML을 직접 받아 보면 전부 붙어 있습니다. 나중에 같은 착각을 하지 않도록 남깁니다.

**남은 한계**: middleware matcher가 제외하는 정적 에셋(`_next/static`·이미지)에는 CSP가 붙지 않습니다. 스크립트·이미지 파일 응답 자체의 CSP는 실행 제어에 영향이 없어 그대로 뒀습니다.

### (2) 레이트리밋 fail-open 유지 — **[결정 2026-07-31] 현상 유지**

**결정**: 바꾸지 않습니다. 로그로 빈도를 먼저 관찰하고, "AI 비용이 실제로 샌다"는 근거가 생기면 그때 `ai_*` 버킷만 fail-closed로 돌립니다.

fail-open이 적용되는 버킷은 5개입니다(`src/lib/rate-limit.ts:12-18`).

| 버킷 | 상한 | 창이 열렸을 때의 손실 |
|---|---|---|
| `ai_draft` | 20/분 | Claude API 비용 |
| `ai_pdf_parse` | 10/분 | Claude API 비용 |
| `ai_contract_insight` | 10/분 | Claude API 비용 |
| `signature_send` | 5/분 | 메일 발송량 |
| `dunning_send` | 5/분 | 메일 발송량 |

**돈이 직접 걸린 판정은 이미 분리돼 fail-closed입니다** — `consumeImportQuota()`(`plan.ts:125`)와 `canCreateContract()`(`plan.ts:154`)는 오류 시 `GATE_UNAVAILABLE`로 거부합니다. 그래서 남은 선택지는 "DB가 흔들리는 짧은 창 동안 AI 호출 상한이 사라지는 것을 감수할지" 하나뿐이고, fail-closed의 대가는 그 창에서 **AI 초안 기능 자체가 죽는 것**입니다. 관찰 없이 바꾸면 있지도 않은 문제 때문에 가용성을 깎게 됩니다.

- **지금**: 레이트리밋 저장소가 죽으면 요청을 통과시킵니다(가용성 우선). 다만 이제 **로그로 남습니다**.
- **바꾼 것**: 과금 경계인 무료 파싱 쿼터(`consumeImportQuota`)와 계약 생성·서명 게이트는 **fail-closed**로 돌렸습니다(오류 시 거부). 돈이 걸린 판정은 통과시키면 안 되니까요.
- **선택지**: AI 호출 버킷(Claude 비용)까지 fail-closed로 갈지. 그러면 DB가 잠깐 흔들릴 때 사용자가 "일시적으로 처리할 수 없어요"를 보게 됩니다. 지금은 비용보다 가용성을 택한 상태입니다.
- **추천**: **현상 유지.** 진짜 손실 경계(무료 파싱 쿼터·계약 생성·서명)는 이미 fail-closed입니다. 남은 건 AI 초안 호출인데, 레이트리밋 저장소가 죽은 짧은 창에 유출될 수 있는 비용보다 "AI 초안이 안 되는 앱"의 체감 손상이 큽니다. 로그가 남으니 실제로 이 창이 열리는 빈도를 먼저 관찰하는 게 순서입니다.

### (3) 독촉 발송 "선점 후 발송" 재정렬 — **[결정 2026-07-31] 현상 유지**

**결정**: 순서를 바꾸지 않습니다. 두 실패 모드 중 싼 쪽을 남긴 구조라 바꿀 이유가 없습니다.

- **지금 순서의 실패**(`dunning-actions.ts:99→113`): 메일은 나갔는데 DB UPDATE 실패 → 초안이 `pending_review`로 남아 **같은 독촉이 두 번 나갈 수 있음**.
- **뒤집었을 때의 실패**: `sent` 선점 후 발송 실패 → **안 보낸 독촉이 "보냈다"로 기록됨**.

미수금 분쟁 증빙이 이 제품의 코어라 후자가 압도적으로 비쌉니다. 중복 발송은 `dunning_send` 5회/분 상한과 `.eq("status", "pending_review")` 조건부 UPDATE로 이미 폭주가 막혀 있습니다.

- **지금**: 메일 발송 성공 → `sent` 전이 순서. 발송 상한(5회/분)을 새로 걸어서 중복 폭주는 막았습니다.
- **선택지**: 순서를 뒤집으면(먼저 `sent`로 선점 후 발송) 중복 발송은 더 확실히 막히지만, 발송이 실패했는데 이미 `sent`로 찍혀 **독촉을 안 보낸 채 보냈다고 기록**될 수 있습니다. 미수금 분쟁 증빙이 핵심인 제품이라 현재 순서를 유지했습니다.
- **추천**: **현상 유지.** 이 제품의 방어 가능한 코어가 "기록 체인의 정확성"입니다. 안 보낸 독촉이 보냈다고 남는 쪽이 중복 발송보다 훨씬 비쌉니다. 중복은 이미 분당 상한으로 막았습니다.

### (4) 완결 TSA 다이제스트 함께 저장 — **[결정 2026-07-31] 불필요, 닫음**

**이 항목의 전제가 틀렸습니다.** "재검증하려면 다이제스트를 저장해야 한다"고 적었지만, **이미 기존 데이터만으로 재계산됩니다.**

다이제스트는 `computeCompletionDigest(docHash, signatureImage)` = `sha256( utf8(doc_hash) ∥ utf8(hex(sha256(서명이미지 바이트))) )`(`src/lib/signing-digest.ts`)인데, 입력 두 개가 둘 다 DB에 있습니다.

- `contracts.doc_hash`
- `contract_signatures.signature_image_data` — 원격 확인 결과 **counterparty 행도 전부 보유**

스탬프에 넘긴 문자열과 저장된 문자열이 같은 값(`parsed.data.signatureDataUrl`)이라 재계산하면 동일한 다이제스트가 나옵니다. 컬럼을 추가하면 **파생 가능한 값을 중복 저장**하는 것이고, 원본과 어긋날 수 있는 상태만 하나 늘어납니다.

정말 필요한 것은 컬럼이 아니라 재검증 스크립트이고, 그건 필요해질 때 지금 데이터로 바로 쓸 수 있습니다.

---

## 6-1. OWASP 재스캔 결과 (2026-07-31)

같은 `/owasp-scan` 스킬로 다시 돌렸습니다. 서브에이전트 57개, 확정 **31건**.

| | 이전 (7/30, `2bb38bf`) | 이번 (7/31) | 변화 |
|---|---|---|---|
| Critical | 1 | **0** | −1 |
| High | 13 | 5 | −8 |
| Medium | 18 | 12 | −6 |
| Low | 13 | 13 | 0 |
| Info | 2 | 1 | −1 |
| **합계** | **47** | **31** | **−16 (34%)** |

> 두 스캔은 같은 구성이지만 서브에이전트 탐색이 결정적이지 않습니다. **건수는 추세로만** 읽으세요. 실제로 항목 제목이 두 스캔에서 거의 다 달라 자동 대조가 안 됩니다.

### high 4건 — [완료 2026-07-31] 전부 수정·배포

> 표에는 "high 5건"이라고 적었지만 실제로 나열된 항목은 4건입니다. 다섯 번째가 무엇이었는지는 대시보드 Artifact와 대조가 필요합니다.

| 항목 | 조치 | 커밋 |
|---|---|---|
| 1. `/ingest` 쿠키 전달 | rewrite → 쿠키를 벗기는 라우트 핸들러 | `dda744c` |
| 2. 서명 후 계약 변조 | `contracts_update_own`에 `status='draft'` (0045, 원격 적용 완료) | `e3f5e81` |
| 3. `doc_hash` DEFINER 파라미터 | 서명 페이지에서 지문 재계산·대조, 불일치면 서명 차단 | `95ee6dd` |
| 4. Polar 쿼리스트링 패스스루 | 쿼리스트링을 서버가 처음부터 재구성 | `5017885` |

아래는 수정 전 원문입니다.

1. **`/ingest` 프록시가 Supabase 세션 쿠키를 PostHog로 전달** — `next.config.ts:80`. 광고차단기 우회용 동일 출처 리라이트인데, 동일 출처라서 `path="/"` 인 `sb-*-auth-token`이 자동으로 붙고 Next 프록시가 Cookie 헤더를 그대로 외부로 넘깁니다. httpOnly·SameSite가 이 경로는 막지 못합니다. **이번 스캔에서 가장 무겁습니다.**
2. **서명 후 계약 본문 변조 가능** — `0037_contract_invoice_column_grants.sql:106` (A06·A08 두 축이 같은 뿌리를 지적). `contracts_update_own` 정책에 status 조건이 없어, 소유자가 PostgREST로 `sent`·`signed` 계약의 `clauses`·`amount`를 직접 PATCH할 수 있습니다. 상태 가드가 전부 RPC 안에만 있어 RPC를 안 거치면 그만입니다. **"계약 → 서명 → 입금" 증빙 체인이 제품의 코어라 여기가 아프면 제품이 아픕니다.**
3. **`doc_hash`가 DEFINER RPC 파라미터** — `0035_domain_rpc_definer.sql:355`. Server Action은 서버에서 해시를 재계산하지만, `send_signature_request_with_event`가 `authenticated`에 열려 있어 PostgREST 직접 호출로 임의 해시를 넣을 수 있습니다.
4. **Polar 체크아웃 쿼리스트링 패스스루** — `src/app/api/billing/checkout/route.ts:25` (confidence: 추정). 3개만 덮어쓰고 `discountId`·`metadata` 등 나머지는 클라이언트가 넣는 대로 결제 API로 갑니다. 지금은 Polar 미구성이라 도달 자체가 안 됩니다.

전체 31건과 수정 방안은 대시보드 Artifact에 있습니다.

### 수정 시 정직하게 남기는 것 (2026-07-31)

- **3번은 "위조를 막는" 것이 아니라 "위조가 증거로 굳는 것을 막는" 수정입니다.** `doc_hash`는 여전히 발송 RPC의 파라미터라 소유자가 PostgREST로 임의 값을 행에 쓸 수 있습니다. SQL에서 지문을 재계산하려면 JS 정규화(키 정렬·공백 없는 직렬화)를 복제해야 하는데, 그쪽이 훨씬 깨지기 쉬워 택하지 않았습니다. 대신 상대방이 서명하기 전에 서버가 같은 함수로 재계산해 대조하고, 불일치면 서명 UI를 렌더하지 않습니다. 서명이 완결되지 않으면 완결증명서도 나오지 않습니다(409).
- **오탐 위험은 프로덕션 실데이터로 확인했습니다.** anon 키 + 테스트 계정 로그인으로 `doc_hash`가 있는 계약 2건을 읽어 재계산했고 둘 다 일치했습니다(서명 대기 중인 건 포함). 즉 기존 서명 링크가 이 검사에 막히지 않습니다.
- **1번은 분석 트래픽을 서버리스 함수로 옮깁니다.** rewrite는 Vercel 프록시 계층이 처리했지만 라우트 핸들러는 함수 호출입니다. 쿠키를 벗기려면 어차피 함수가 필요하고(미들웨어도 함수), 개인 규모에서는 무시할 수준입니다.
- **`/api/billing/portal`은 손대지 않았습니다.** 같은 패스스루 형태지만 스캔이 지적한 것은 checkout뿐이고, 포털은 고객 식별을 `getCustomerId`로 서버에서 넘깁니다.

> 참고: 이번 CSP 변경 때문에 새 medium 1건이 생겼습니다 — "CSP에 `default-src`·`connect-src`·`img-src`가 없다". `script-src`만 최소 범위로 넣었기 때문이고, 그 지시자들은 **변경 전에도 없었습니다.** 확장은 별도 판단 사항입니다(연결 대상이 Supabase·PostHog·Polar로 여러 곳이라 좁히려면 실측이 또 필요합니다).

---

## 7. 문제가 생기면 (롤백)

- **코드 롤백**: Vercel 대시보드에서 이전 배포로 "Promote to Production" 하면 즉시 되돌아갑니다.
- **DB 롤백**: 마이그레이션은 되돌리는 스크립트를 따로 만들지 않았습니다. 급하면 아래로 권한만 임시 복구할 수 있습니다(보안 구멍이 다시 열리니 **임시로만**):
  ```sql
  grant insert on public.invoices to authenticated;
  grant insert, update on public.clients to authenticated;
  grant insert, update on public.contracts to authenticated;
  ```
  0042~0044(함수 실행권 회수)를 되돌려야 한다면 `grant execute on function <시그니처> to authenticated;`입니다. 다만 이 3건은 **쓰이지 않던 권한을 회수한 것**이라 앱 동작으로 되돌릴 일은 없어야 정상입니다.
- 어느 쪽이든, 원인 로그는 Vercel 함수 로그와 PostHog 에러 트래킹에 남습니다(이번에 크론·인증 실패·레이트리밋 차단 로깅을 전부 추가했습니다).

---

## 8. [완료 2026-07-31] 배포 후 브라우저 확인

**결과: (1)(2) 모두 통과.** 근거는 아래 절차 뒤에 실측으로 붙였습니다.

### 실측 (2026-07-31 20:2x)

| 확인 | 결과 |
|---|---|
| `/ingest/e/` · `s/?sent_at=` · `flags/?v=2` | 전부 **200**. 에셋(`config.js`·`surveys.js`)은 disk cache 200 |
| PostHog Activity | Pageview·Web vitals·`clicked link with text "계약"` 수신, person 식별도 정상 |
| 서명 페이지 | 조항 + 문서 지문 + 서명 카드 정상 렌더 (새 지문 대조가 오탐 없음) |
| 서명 완결 (계약 `test`) | 계약 `signed` · 요청 `completed` · 서명 2건 · 이벤트 3건 |
| 발송·완결 TSA 토큰 | 둘 다 확보 → **프로덕션 `TSA_URL`이 https임이 여기서 확정**(4절) |
| `doc_hash == frozen_doc_hash` | 일치 |

즉 0045(계약 본문 동결)와 지문 대조를 넣은 뒤에도 **서명 발송 → 완결 → 증거 기록 체인이 그대로 돕니다.**

### 절차 (다음에 같은 확인이 필요할 때)

2026-07-31 배포분(`e3f5e81`~`5017885` + 의존성 5건)에서 **자동으로는 확인할 수 없는 2가지**입니다. 나머지(마이그레이션 적용·CI·프로덕션 200 응답)는 이미 확인했습니다.

### (1) 분석 이벤트가 여전히 들어오는가 — `/ingest` 프록시 교체

`/ingest`가 next.config 리라이트에서 라우트 핸들러로 바뀌었습니다. 정적 에셋 응답이 200인 것은 확인했지만, **이벤트가 PostHog까지 실제로 도달하는지**는 브라우저로만 알 수 있습니다.

1. 크롬에서 `https://maedeup.app` 을 열고 로그인합니다.
2. `F12`(또는 `⌥⌘I`) → **Network** 탭 → 필터 입력창에 `ingest` 입력.
3. 상단 메뉴로 **대시보드 → 계약 → 인보이스** 순서로 3페이지쯤 이동합니다.
4. Network 목록에 `e/?...` 또는 `i/v0/e/...` 요청이 뜨고 **Status가 200**이면 통과입니다.
   - Request Headers에 `Cookie`가 보이는 것은 **정상**입니다. 그건 브라우저→우리 서버 구간이고, 우리 서버가 PostHog로 넘길 때 벗겨냅니다.
   - **실패 신호**: 이 요청들이 404거나 500이면 알려주세요.
5. 최종 확인은 PostHog에서 합니다. `https://us.posthog.com/project/514785/activity` 를 열고, 방금 이동한 페이지뷰가 **몇 분 안에 올라오는지** 봅니다.
   - 이벤트가 안 보이면 알려주세요. 다만 자동화 브라우저가 아닌 **평소 쓰는 크롬**이어야 합니다(헤드리스는 posthog-js가 드롭합니다).

### (2) 서명 링크가 정상으로 열리는가 — 문서 지문 대조 도입

서명 페이지가 이제 계약 본문에서 지문을 재계산해 발송 시점 지문과 대조합니다. 불일치면 서명 UI 대신 안내 카드가 뜹니다. 기존 데이터 2건으로는 일치를 확인했지만, **새로 발송한 링크로 한 번 더** 봐 주세요.

1. `https://maedeup.app/contracts` → **새 계약** 으로 아무 계약이나 하나 만듭니다(클라이언트는 기존 것 아무거나).
2. 계약 상세에서 **서명 요청 보내기** → 받는 사람 이메일에 **본인 주소**를 넣습니다.
   - `EMAIL_FROM`이 미설정이라 발신자가 `onboarding@resend.dev`이고, 이 공용 도메인은 보통 계정 본인 주소로만 발송됩니다.
3. 메일함에서 서명 링크를 엽니다.
4. **통과 기준**: "계약 조항" 카드 아래에 **문서 지문 (SHA-256)** 이 보이고, 그 아래 "서명하기" 카드가 나오면 정상입니다.
   - **실패 신호**: "이 서명 링크는 사용할 수 없습니다 / 계약 본문과 발송 시점 문서 지문이 일치하지 않습니다" 가 뜨면 **새 검사가 오탐**인 것이니 즉시 알려주세요. (`95ee6dd` 되돌리면 원복됩니다.)
5. 이왕 여신 김에 실제로 서명까지 완결해 두면 좋습니다 — 0045 적용 후 서명 완결 경로가 여전히 도는지까지 확인됩니다.

### (3) 계약 편집이 여전히 되는가 — 0045 회귀 확인 (선택)

정책을 조였으니 **초안 편집이 안 깨졌는지**만 한 번 봐 주세요.

1. `/contracts` 에서 **초안** 상태 계약 하나를 엽니다.
2. 조항을 아무거나 수정하고 저장 → **성공해야 정상**입니다.
3. **서명 대기/서명완료** 계약에서는 원래부터 조항 편집 버튼이 없습니다. 여기서 편집이 막히는 건 정상 동작입니다.

---

## 체크리스트 (복사해서 쓰세요)

- [x] 0038 → 0039 → 0040 → 0041 순서로 원격 적용 (2026-07-31)
- [x] 검증 쿼리 5개 실행해서 기대값 확인 (2026-07-31)
- [x] 권한 잔여분 0042~0044 적용 — 세션 없는 경계 RPC 실행권 최소화 (2026-07-31, `838d8cc`)
- [x] GitHub Actions 초록인지 → CI 자체가 고장나 있었음. `9cd482b`로 수정, `30606656779` 첫 그린 (2026-07-31)
- [x] `RESEND_API_KEY`·`CRON_SECRET` 확인 — 둘 다 존재, `CRON_SECRET`은 DB 해시와 일치 (2026-07-31)
- [x] Polar 미구성 500 → "결제 준비 중" 안내 폴백 (2026-07-31, `6d36be2`)
- [x] **브라우저 플로우 7단계 전부 통과** (2026-07-31)
- [x] 서명 완결 → 완결증명서 PDF 200 · **완결 시점 TSA 토큰 확보** (2026-07-31)
- [x] 크론 호출 → `ok:true` 확인, 독촉 스윕 부활 (2026-07-31)
- [x] Dependabot 8건 재실행 → 그린 5 · 레드 3, 원인 규명 (2026-07-31)
- [x] 6번 (1) CSP nonce 구현 + dev·프로덕션 빌드 실측 · 커밋 (2026-07-31, `07cfbbd`)
- [x] `TSA_URL` https 여부(**프로덕션**) — 프로덕션 서명 완결에서 완결 TSA 토큰이 저장돼 https 확정 (2026-07-31, 4절)
- [x] Dependabot 8건 전부 정리 (2026-07-31) — 병합 #5·#4·#3·#2·#8, 닫음 #6·#7(대안 조합으로 해결)·#9(3.4 유지 + ignore 규칙)
- [x] 6번 (2)(3) 현상 유지 · (4) 불필요로 닫음 (2026-07-31)
- [x] **재스캔 high 4건 전부 수정·배포** (6-1절, 2026-07-31)
- [x] 배포 후 브라우저 확인 — 분석 이벤트 수신 · 서명 링크 정상 렌더 · 서명 완결까지 (2026-07-31, 8절)
- [ ] 8/1 06:00(KST) 이후 Vercel 함수 로그에서 일일 크론 실제 실행 1회 확인
- [ ] (사업 판단 후) Polar 프로덕션 전환 — 4절 체크리스트. **`set_billing_webhook_secret` 빠뜨리지 말 것**
- [ ] 결제 켜기 전 `src/lib/legal.ts`의 `LEGAL` placeholder 기입 (0절 3번)
- [ ] `can_approve_pull_request_reviews=true` 토글 + PR #18로 승인 경로 재검증 → 테스트 PR #16·#17·#18 정리 (0절 6번)
- [ ] `E2E_TEST_EMAIL`·`E2E_TEST_PASSWORD` Actions 시크릿 등록 (0절 7번, 없으면 E2E 영구 스킵)

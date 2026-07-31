# 보안 수정 후속 작업 (한민석님이 해야 하는 일)

작성: 2026-07-31 · 대상 커밋: `7c0200a`(origin/main에 push 완료)
관련 문서: `docs/SECURITY_REMEDIATION_PLAN.md`(무엇을 왜 고쳤는지 정본), OWASP 대시보드 Artifact

---

## 0. 지금 상태 — 먼저 읽어주세요

> **업데이트 2026-07-31**: 마이그레이션 **0038~0041을 원격(`jbfxkcjeoqwcdsxuemug`)에 순서대로 적용 완료**했고, 아래 2번의 검증 쿼리 5개도 전부 기대값과 일치했습니다. 이후 권한 잔여분 정리(0042~0044)와 **5번(CI)** 도 끝났습니다. 남은 것은 **3번(브라우저 플로우)·4번(환경변수)·6번(판단 항목)** 입니다.

OWASP 스캔 47건의 **코드 수정은 전부 끝났고 main에 push까지 됐습니다.** 테스트 735개·lint·`build:verify`·`npm audit --omit=dev`(0건) 모두 그린입니다.

> 왜 이런 순서가 됐나: 코드와 DB 권한이 한 쌍입니다. DB를 먼저 바꾸면 "예전 코드가 직접 INSERT하다가 권한 거부"로 깨지고, 코드를 먼저 배포하면 "새 코드가 아직 없는 함수를 호출"해서 깨집니다. 어느 쪽이든 몇 분짜리 창이 생기는데, 깨지는 범위가 더 좁은 쪽(코드 먼저)을 골랐습니다.

---

## 1. [완료] 원격 마이그레이션 0038~0041 적용

### 왜 해야 하나

이번에 고친 보안 결함 중 **절반은 DB 안에 있습니다.** 코드만 배포하면 아래 구멍이 그대로 열려 있습니다.

- **0038** — 크론이 남의 데이터를 긁어오는 구멍. 공격자가 "내 인보이스인데 `client_id`는 피해자 것"인 행을 만들어두면, 매일 도는 독촉 크론이 RLS를 우회하는 함수로 조인해서 **피해자의 클라이언트 이름·계약 제목을 공격자 화면에 띄워줍니다.** 조인에 테넌트 조건을 넣고, 애초에 남의 `client_id`/`contract_id`를 참조하지 못하도록 정책도 함께 조입니다.
  - 보너스: 이 마이그레이션은 **지금 프로덕션에서 매일 실패 중인 독촉 크론도 고칩니다.** 0034가 0031의 타입 캐스팅(`u.email::text`)을 실수로 빠뜨려서, 원격에서는 독촉 스윕 전체가 에러로 죽고 있었습니다(응답이 항상 200 `ok:true`라 아무도 몰랐음 — 그 부분도 이번에 500으로 바꿨습니다).
- **0039** — `is_demo` 위조 구멍. `is_demo`는 "이 행은 데모니까 물리 삭제해도 된다"는 열쇠인데, 클라이언트가 마음대로 쓸 수 있었습니다. 실제 인보이스를 `is_demo=true`로 바꾼 뒤 **입금 이벤트 로그까지 흔적 없이 삭제**할 수 있었습니다. 이제 데모 생성은 서버 함수(`seed_demo_data`)만 할 수 있고, `is_demo`는 클라이언트 INSERT/UPDATE 권한에서 빠졌습니다.
- **0040** — 서명 완결 시각 증거 선점 구멍. 서명 링크를 가진 쪽이 완결 직후 **아무 값이나 먼저 밀어넣으면**(write-once라 먼저 쓴 값이 확정) 진짜 TSA 타임스탬프가 저장되지 못하고 가짜가 증명서에 박혔습니다. 이제 서버 시크릿을 아는 우리 서버만 저장할 수 있습니다.
- **0041** — 크론·웹훅 시크릿이 DB에 **평문**으로 들어 있었습니다. DB 덤프/백업이 한 번 새면 크론·결제 웹훅 경계를 바로 통과할 수 있습니다. 이제 sha256 해시만 저장합니다.

### 어떻게 하나

새 Claude Code 세션에서 아래처럼 요청하시면 됩니다(제가 MCP로 직접 적용합니다):

> "supabase MCP로 supabase/migrations/0038, 0039, 0040, 0041을 순서대로 apply_migration 해줘"

직접 하시려면 Supabase 대시보드 SQL Editor에 파일 내용을 **번호 순서대로** 붙여넣어 실행해도 됩니다. 순서가 중요합니다(0041이 0038~0040이 만든 함수를 다시 정의하지는 않지만, 0040은 0027의 게이트 함수를, 0041은 그 게이트 함수를 다시 씁니다).

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

## 2. [필수] 적용 후 원격 검증

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

### 크론 살아났는지 확인 (권장)

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://freesign.vercel.app/api/cron/daily
```
- **기대**: `200` + `{"ok":true,"ran":{"dunning":{"ok":true,...},"recurring":{"ok":true,...}}}`
- 하나라도 실패하면 이제 **500**이 나옵니다(예전엔 실패해도 200이라 몰랐던 부분).
- 안전성: 이 호출은 독촉 **초안(pending_review)** 과 인보이스 **draft**만 만듭니다. 클라이언트에게 메일이 나가지 않습니다(발송은 앱에서 승인해야만).

---

## 3. [필수] 브라우저로 실제 플로우 확인

**0035~0041을 통틀어 아직 한 번도 브라우저로 태워본 적이 없습니다.** 상태 전이·서명·데모 경로를 전부 DB 함수 뒤로 옮겼기 때문에, SQL 테스트가 그린이어도 실제 화면에서 한 번은 확인해야 안심할 수 있습니다. 아래 순서로 5~10분이면 됩니다.

1. **로그인 → 대시보드** — 세션 쿠키를 `httpOnly`로 바꿨습니다(#28). 로그인·새로고침·로그아웃이 정상이면 통과. (개발자도구 → Application → Cookies에서 `sb-*` 쿠키의 HttpOnly 체크가 켜져 있으면 성공)
2. **데모 데이터 채우기 → 지우기** — 0039의 핵심. 채우기가 되면 새 `seed_demo_data` RPC가 정상, 지우기가 되면 데모 삭제 정책이 그대로 동작.
3. **클라이언트 생성·수정** — 컬럼 권한을 좁혔으니 여기서 에러가 나면 권한 목록이 잘못된 것.
4. **계약 초안 생성(AI) → 인보이스 발행 → 입금 표시** — INSERT 권한 회수 후에도 정상 동작하는지.
5. **서명 발송 → `/sign/{token}` 열람 → 상대방 서명 완결 → 계약서·완결증명서 PDF 다운로드** — 가장 중요합니다. 완결 후 증명서의 **타임스탬프 항목**이 채워지는지 보세요(0040 + TSA 검증이 정상이라는 뜻).
6. **계약 삭제** — 물리 삭제 후 인보이스가 남고 계약 요약(`contract_snapshot`)이 유지되는지.
7. (선택) 서명 페이지를 1분 안에 20번 이상 새로고침 → 21번째부터 "잠시 후 다시 시도" 카드가 나오면 #25 정상.

---

## 4. [확인] 환경변수 2개 점검

### `TSA_URL` — **https여야 합니다** (안 그러면 500)

평문 TSA는 중간자가 가짜 타임스탬프를 증거로 심을 수 있어서 `https://`만 허용하도록 바꿨습니다(#33). Vercel 환경변수의 `TSA_URL`이 `http://`로 시작하면 **완결증명서 PDF 라우트가 500**이 납니다. 기본값 `https://freetsa.org/tsr`면 문제없습니다.

### `RESEND_API_KEY` — 없으면 재발송이 이제 "실패"로 보입니다

예전에는 키가 없어도 콘솔 폴백이 `ok:true`를 돌려줘서 "보낸 것처럼" 보였습니다(그리고 서명 토큰이 그대로 서버 로그에 찍혔습니다 — 배치 1에서 차단). 지금은 프로덕션에서 키가 없으면 발송이 정직하게 실패하고, **서명 재발송 버튼은 에러 메시지를 띄우며 토큰을 원래대로 되돌립니다**(#44 — 예전엔 토큰만 바꿔놓고 메일이 안 나가서 아무도 서명 못 하는 상태가 됐습니다).

키를 아직 안 넣으셨다면 지금이 넣을 때입니다.

---

## 5. [완료] CI — 사실은 한 번도 돈 적이 없었습니다

이번에 CI에 **`npm audit --audit-level=high --omit=dev` 게이트**를 추가했습니다(프로덕션 의존성에 high 취약점이 있으면 빌드 실패).

이 문서는 원래 "지금은 0건이라 통과해야 합니다"라고 적었지만 **틀렸습니다.** 확인해 보니 CI는 최초 도입(`3bdf3d2`) 이후 **단 한 번도 성공한 적이 없었습니다.** 실행 이력이 전부 `0초 · 잡 0개`로 실패했는데, 원인은 e2e 잡의 job-level 조건이었습니다:

```yaml
if: ${{ secrets.E2E_TEST_EMAIL != '' && secrets.E2E_TEST_PASSWORD != '' }}
```

`jobs.<job_id>.if`에서 허용되는 컨텍스트는 `github`·`needs`·`vars`·`inputs`뿐이고 **`secrets`는 불가**입니다. 워크플로 검증 단계에서 거부되므로 잡이 아예 만들어지지 않고, 그래서 로그도 annotation도 남지 않아 아무도 눈치채지 못했습니다. 결과적으로 **공급망 게이트는 추가된 뒤 한 번도 실행되지 않았습니다.**

`9cd482b`에서 secrets를 읽을 수 있는 step `env`로 판정해 job output으로 넘기는 게이트 잡(`e2e-gate`)을 두고, e2e는 `needs`로 그 값을 받도록 고쳤습니다. **실행 `30606656779`이 첫 그린입니다** — audit·lint·build·테스트 737개가 전부 실제로 돌았고, E2E는 시크릿 미설정이라 의도대로 스킵됐습니다.

`.github/dependabot.yml`도 새로 넣었습니다(npm 주간 + GitHub Actions 월간). **PR이 오는 게 정상**입니다. 다만 지금 열려 있는 PR들은 위 결함 때문에 내용과 무관하게 red로 찍혀 있으니, 재실행해서 진짜 결과를 봐야 합니다. 그중 `eslint 9→10`·`tailwindcss 3→4`·`@testing-library/jest-dom 6→7`·`@vitejs/plugin-react 4→6`은 메이저 업그레이드라 실제로 깨질 수 있습니다.

---

## 6. [판단 필요] 제가 일부러 남긴 4가지

전부 "고칠 수는 있지만, 한민석님이 트레이드오프를 골라야 하는" 항목입니다.

### (1) CSP `script-src` nonce — Low
- **지금**: `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `style-src`/`font-src`(self + 핀 고정한 jsDelivr), `Permissions-Policy`까지 넣었습니다.
- **안 한 것**: 스크립트 출처 제한(`script-src`). Next.js가 인라인 부트스트랩 스크립트를 쓰기 때문에 **요청마다 nonce를 만들어 middleware에서 주입**해야 하고, 브라우저 실측 없이 켜면 앱 전체가 하얗게 죽을 수 있습니다.
- **추천**: 별도 세션에서 dev-browser로 검증하면서 도입. 급하지 않습니다(현재 XSS 싱크가 없는 구조).

### (2) 레이트리밋 fail-open 유지 — Low
- **지금**: 레이트리밋 저장소가 죽으면 요청을 통과시킵니다(가용성 우선). 다만 이제 **로그로 남습니다**.
- **바꾼 것**: 과금 경계인 무료 파싱 쿼터(`consumeImportQuota`)와 계약 생성·서명 게이트는 **fail-closed**로 돌렸습니다(오류 시 거부). 돈이 걸린 판정은 통과시키면 안 되니까요.
- **선택지**: AI 호출 버킷(Claude 비용)까지 fail-closed로 갈지. 그러면 DB가 잠깐 흔들릴 때 사용자가 "일시적으로 처리할 수 없어요"를 보게 됩니다. 지금은 비용보다 가용성을 택한 상태입니다.

### (3) 독촉 발송 "선점 후 발송" 재정렬 — Low
- **지금**: 메일 발송 성공 → `sent` 전이 순서. 발송 상한(5회/분)을 새로 걸어서 중복 폭주는 막았습니다.
- **선택지**: 순서를 뒤집으면(먼저 `sent`로 선점 후 발송) 중복 발송은 더 확실히 막히지만, 발송이 실패했는데 이미 `sent`로 찍혀 **독촉을 안 보낸 채 보냈다고 기록**될 수 있습니다. 미수금 분쟁 증빙이 핵심인 제품이라 현재 순서를 유지했습니다.

### (4) 완결 TSA 다이제스트 함께 저장 — Low
- 나중에 `openssl ts -verify` 없이 자동 재검증하려면 스탬프 대상 다이제스트도 저장해두면 좋습니다. 스키마 변경이라 보류했습니다. 필요하면 말씀 주세요.

---

## 7. 문제가 생기면 (롤백)

- **코드 롤백**: Vercel 대시보드에서 이전 배포로 "Promote to Production" 하면 즉시 되돌아갑니다.
- **DB 롤백**: 마이그레이션은 되돌리는 스크립트를 따로 만들지 않았습니다. 급하면 아래로 권한만 임시 복구할 수 있습니다(보안 구멍이 다시 열리니 **임시로만**):
  ```sql
  grant insert on public.invoices to authenticated;
  grant insert, update on public.clients to authenticated;
  grant insert, update on public.contracts to authenticated;
  ```
- 어느 쪽이든, 원인 로그는 Vercel 함수 로그와 PostHog 에러 트래킹에 남습니다(이번에 크론·인증 실패·레이트리밋 차단 로깅을 전부 추가했습니다).

---

## 체크리스트 (복사해서 쓰세요)

- [x] 0038 → 0039 → 0040 → 0041 순서로 원격 적용 (2026-07-31 완료)
- [x] 검증 쿼리 5개 실행해서 기대값 확인 (2026-07-31 완료)
- [ ] `curl` 크론 호출 → `ok:true` 확인 (독촉 크론 부활 확인)
- [ ] 브라우저 플로우 7단계 확인 (특히 데모 시드 + 서명 완결 + 증명서 타임스탬프)
- [ ] Vercel `TSA_URL`이 https인지, `RESEND_API_KEY`가 들어 있는지
- [x] GitHub Actions 초록인지 → CI 자체가 고장나 있었음. `9cd482b`로 수정, `30606656779` 그린 (2026-07-31)
- [ ] Dependabot PR 재실행해서 진짜 red/green 확인 (메이저 4건 주의)
- [ ] 6번 판단 항목 4가지 중 진행할 것 결정

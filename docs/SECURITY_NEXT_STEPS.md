# 보안 수정 후속 작업 (한민석님이 해야 하는 일)

작성: 2026-07-31 · 최종 갱신: 2026-07-31 (브라우저 검증·크론 검증·Dependabot 실측 반영)
관련 문서: `docs/SECURITY_REMEDIATION_PLAN.md`(무엇을 왜 고쳤는지 정본), OWASP 대시보드 Artifact

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

1. **재스캔 high 5건 처리 방향** (6-1절). 특히 `/ingest` 쿠키 전달, 서명 후 계약 변조.
2. **그린 Dependabot PR 5건 병합.** #5·#8·#4·#3·#2.
3. **6절 (2)(3)(4)** — 전부 "현상 유지/나중" 추천.
4. (사업 판단이 서면) **Polar 프로덕션 전환** — 4절의 체크리스트 참고.

> CSP nonce(6절 (1))는 `07cfbbd`로 커밋했습니다.

> 왜 이런 순서가 됐나: 코드와 DB 권한이 한 쌍입니다. DB를 먼저 바꾸면 "예전 코드가 직접 INSERT하다가 권한 거부"로 깨지고, 코드를 먼저 배포하면 "새 코드가 아직 없는 함수를 호출"해서 깨집니다. 어느 쪽이든 몇 분짜리 창이 생기는데, 깨지는 범위가 더 좁은 쪽(코드 먼저)을 골랐습니다.

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
- **Vercel의 실제 일일 실행은 아직 확인 못 했습니다.** 스케줄이 `0 21 * * *`(UTC) = KST 06:00이라, 마이그레이션 적용(7/31 오전) 이후 첫 실행은 8/1 06:00입니다. 그때 Vercel 함수 로그를 한 번 보시면 완결됩니다(런타임 로그 보존이 짧아 미리 볼 수 없습니다).

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
- **서명 요청 메일은 본인 주소로** 보내세요. `EMAIL_FROM`이 미설정이라 발신자가 `FreeSign <onboarding@resend.dev>`인데(`src/services/email/provider.ts:29`), Resend의 이 공용 도메인은 보통 계정 본인 주소로만 발송이 허용됩니다.

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

**판단: 3절 브라우저 검증으로 미룹니다.** 5단계의 완결증명서 PDF가 200이면 https가 맞고, 500이면 http입니다 — 검증이 곧 판정입니다. 500이 나오면 그때 `vercel env rm/add TSA_URL production` 후 재배포하면 됩니다(로컬 값은 `https://freetsa.org/tsr`로 올바름).

> 문서 초판의 "기본값 `https://freetsa.org/tsr`면 문제없습니다"는 오해 소지가 있어 정정합니다. **미설정 시 기본값이 자동 적용되지 않습니다.** `DEFAULT_PUBLIC_TSA_URL`은 문서화용 상수고, `TSA_URL`이 없으면 500이 아니라 **조용한 noop**(타임스탬프 없음)입니다 — `src/services/timestamp/provider.ts:17-19`.

### `RESEND_API_KEY` — 설정돼 있습니다

예전에는 키가 없어도 콘솔 폴백이 `ok:true`를 돌려줘서 "보낸 것처럼" 보였습니다(그리고 서명 토큰이 그대로 서버 로그에 찍혔습니다 — 배치 1에서 차단). 지금은 프로덕션에서 키가 없으면 발송이 정직하게 실패하고, **서명 재발송 버튼은 에러 메시지를 띄우며 토큰을 원래대로 되돌립니다**(#44).

키는 있으므로 남은 건 `EMAIL_FROM`뿐입니다 — 도메인 인증 후 설정하면 제3자 발송이 열립니다.

### Polar 미구성 — 500은 [완료], 프로덕션 전환은 [보류]

**발견**: `POLAR_ACCESS_TOKEN`·`POLAR_WEBHOOK_SECRET`·`POLAR_PRODUCT_ID`·`POLAR_SERVER`가 프로덕션에 전부 없어 `/api/billing/checkout`·`portal`이 `getPolarEnv()`의 필수 스키마에서 던지고 **500**이었습니다. `UpgradeCard`/`UpgradeButton`이 대시보드·리포트·인보이스 상세·반복 인보이스에 렌더되므로 **Free 사용자가 대시보드에서 바로 밟는 500**이었습니다.

**조치**(`6d36be2`): 미구성은 요청 오류가 아니라 배포 상태이므로, `isPolarConfigured()`로 먼저 판별해 `/billing?portal=not_configured`로 되돌리고 그 화면은 오류(`alert`)가 아니라 안내(`status`)로 렌더합니다. env를 채우면 이 분기는 자동으로 비활성화됩니다.

webhook 라우트는 손대지 않았습니다 — 시크릿이 빈 문자열이면 SDK 서명 검증에서 먼저 막혀 `applySubscriptionEvent`까지 도달하지 않습니다(이미 fail-closed).

**나중에 프로덕션 결제로 전환할 때 체크리스트**
1. Polar 대시보드에서 프로덕션 조직·상품·액세스 토큰·웹훅 엔드포인트(`https://freesign.vercel.app/api/billing/webhook`) 생성
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

메이저 4건 중 실제로 깨진 건 3건이고, 셋 다 **우리 코드가 아니라 생태계 호환성** 문제입니다. 병합은 GitHub 쓰기라 실행하지 않고 남겨둡니다.

---

## 6. [판단 필요] 제가 일부러 남긴 4가지

전부 "고칠 수는 있지만, 한민석님이 트레이드오프를 골라야 하는" 항목입니다.

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

### (2) 레이트리밋 fail-open 유지 — Low
- **지금**: 레이트리밋 저장소가 죽으면 요청을 통과시킵니다(가용성 우선). 다만 이제 **로그로 남습니다**.
- **바꾼 것**: 과금 경계인 무료 파싱 쿼터(`consumeImportQuota`)와 계약 생성·서명 게이트는 **fail-closed**로 돌렸습니다(오류 시 거부). 돈이 걸린 판정은 통과시키면 안 되니까요.
- **선택지**: AI 호출 버킷(Claude 비용)까지 fail-closed로 갈지. 그러면 DB가 잠깐 흔들릴 때 사용자가 "일시적으로 처리할 수 없어요"를 보게 됩니다. 지금은 비용보다 가용성을 택한 상태입니다.
- **추천**: **현상 유지.** 진짜 손실 경계(무료 파싱 쿼터·계약 생성·서명)는 이미 fail-closed입니다. 남은 건 AI 초안 호출인데, 레이트리밋 저장소가 죽은 짧은 창에 유출될 수 있는 비용보다 "AI 초안이 안 되는 앱"의 체감 손상이 큽니다. 로그가 남으니 실제로 이 창이 열리는 빈도를 먼저 관찰하는 게 순서입니다.

### (3) 독촉 발송 "선점 후 발송" 재정렬 — Low
- **지금**: 메일 발송 성공 → `sent` 전이 순서. 발송 상한(5회/분)을 새로 걸어서 중복 폭주는 막았습니다.
- **선택지**: 순서를 뒤집으면(먼저 `sent`로 선점 후 발송) 중복 발송은 더 확실히 막히지만, 발송이 실패했는데 이미 `sent`로 찍혀 **독촉을 안 보낸 채 보냈다고 기록**될 수 있습니다. 미수금 분쟁 증빙이 핵심인 제품이라 현재 순서를 유지했습니다.
- **추천**: **현상 유지.** 이 제품의 방어 가능한 코어가 "기록 체인의 정확성"입니다. 안 보낸 독촉이 보냈다고 남는 쪽이 중복 발송보다 훨씬 비쌉니다. 중복은 이미 분당 상한으로 막았습니다.

### (4) 완결 TSA 다이제스트 함께 저장 — Low
- 나중에 `openssl ts -verify` 없이 자동 재검증하려면 스탬프 대상 다이제스트도 저장해두면 좋습니다. 스키마 변경이라 보류했습니다.
- **추천**: **3절 서명 완결 검증을 마친 뒤에 판단.** 지금은 완결 TSA 토큰이 실제로 저장되는지조차 브라우저로 확인하지 못한 상태라, 그걸 먼저 보고 나서 "재검증 자동화가 필요한가"를 정하는 게 순서입니다. 컬럼 하나 추가라 나중에 해도 비용은 같습니다.

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

### 남은 high 5건 (전부 verify + 2차 adversarial 패널 통과)

1. **`/ingest` 프록시가 Supabase 세션 쿠키를 PostHog로 전달** — `next.config.ts:80`. 광고차단기 우회용 동일 출처 리라이트인데, 동일 출처라서 `path="/"` 인 `sb-*-auth-token`이 자동으로 붙고 Next 프록시가 Cookie 헤더를 그대로 외부로 넘깁니다. httpOnly·SameSite가 이 경로는 막지 못합니다. **이번 스캔에서 가장 무겁습니다.**
2. **서명 후 계약 본문 변조 가능** — `0037_contract_invoice_column_grants.sql:106` (A06·A08 두 축이 같은 뿌리를 지적). `contracts_update_own` 정책에 status 조건이 없어, 소유자가 PostgREST로 `sent`·`signed` 계약의 `clauses`·`amount`를 직접 PATCH할 수 있습니다. 상태 가드가 전부 RPC 안에만 있어 RPC를 안 거치면 그만입니다. **"계약 → 서명 → 입금" 증빙 체인이 제품의 코어라 여기가 아프면 제품이 아픕니다.**
3. **`doc_hash`가 DEFINER RPC 파라미터** — `0035_domain_rpc_definer.sql:355`. Server Action은 서버에서 해시를 재계산하지만, `send_signature_request_with_event`가 `authenticated`에 열려 있어 PostgREST 직접 호출로 임의 해시를 넣을 수 있습니다.
4. **Polar 체크아웃 쿼리스트링 패스스루** — `src/app/api/billing/checkout/route.ts:25` (confidence: 추정). 3개만 덮어쓰고 `discountId`·`metadata` 등 나머지는 클라이언트가 넣는 대로 결제 API로 갑니다. 지금은 Polar 미구성이라 도달 자체가 안 됩니다.

전체 31건과 수정 방안은 대시보드 Artifact에 있습니다.

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
- [ ] `TSA_URL` https 여부(**프로덕션**) — 로컬은 확정됐지만 Vercel 값은 Sensitive라 여전히 미확인. 확정하려면 알려진 값으로 덮어쓰기
- [ ] Dependabot 그린 5건 병합(#5·#8·#4·#3·#2) · 레드 3건 처리(#6 닫기 / #7·#9 별도 작업)
- [ ] 6번 (2)(3)(4) — 전부 "현상 유지/나중" 추천. 다르게 가실지만 결정
- [ ] **재스캔 high 5건 처리 방향 결정** (6-1절). 특히 `/ingest` 쿠키 전달과 서명 후 계약 변조
- [ ] 8/1 06:00(KST) 이후 Vercel 함수 로그에서 일일 크론 실제 실행 1회 확인
- [ ] (사업 판단 후) Polar 프로덕션 전환 — 4절 체크리스트. **`set_billing_webhook_secret` 빠뜨리지 말 것**

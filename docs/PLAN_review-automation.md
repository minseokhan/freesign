# 계획: 코드리뷰 자동화 2층 (pre-commit + GitHub Actions)

작성 2026-08-07. 상태: **전 단계 완료 · 2026-08-09 실검증 통과**

최종 검증(PR #16, 런 31278798057): 의도한 결함 5개를 전부 잡고
`Blocked` / `CHANGES_REQUESTED` + 인라인 7건 게시. 7분 50초.
심지 않은 진짜 결함 2건(부분입금 누적 미반영, 미완납에 paid_at 기록)도 추가로 찾았고,
`/api/invoices/[id]` 라우트가 실제로 없다는 것까지 확인해 지적했다.

B층을 돌리며 실제로 걸린 것 (문서에 없던 전제들):
- **Claude GitHub App 설치**가 별도 전제다. `github_token`을 직접 넘기면 건너뛸 수 있다.
- 액션은 **`.claude/`·`CLAUDE.md`를 origin/main에서 복원**한다(PR head는 untrusted).
  스킬 수정은 main에 올라가야만 러너에 반영된다 — 브랜치에 두면 영원히 안 먹는다.
- **`Workflow` 툴은 존재하지만 헤드리스에서 완주하지 못한다.** 백그라운드로 돌기 때문에
  메인 에이전트가 더 호출할 툴이 없어지는 순간 런이 끝난다. `--ci`에서 `Task` 팬아웃으로 분기.
- **Stop 훅이 CI 러너에서도 실행**된다. `$CI`면 건너뛰도록 했다(ci.yml이 같은 일을 한다).
- 인증은 구독 OAuth 토큰. API 키는 크레딧 소진으로 `is_error`가 났다.
- 리뷰 1건당 소요 ~8분.

실행 중 계획과 달라진 것:
- SR-01 예외에 `src/lib/env.ts`(env 스키마 정본)·`static-rules.ts`(규칙 카탈로그 자신)·
  테스트 파일/하네스를 추가했다. 애초 scope(`src/**` 전부)로는 오탐 18건이 났다.
- SR-03은 **타입 전용 import를 제외**해야 한다. `import type`은 컴파일 시 지워져
  번들에 없다. 이걸 빼먹어 `contract-import-form.tsx`가 오탐으로 걸렸다.
- 베이스라인 스캔(`--all`)은 `git ls-files`만 보면 **untracked 새 파일을 건너뛰어
  가짜 그린**을 낸다. 실제로 스캐너 자신이 그 구멍으로 빠져나가 첫 커밋에서야 걸렸다.
  `--cached --others --exclude-standard`로 고쳤다.
- CI 인증은 API 키로 결정. 액션은 레포 관례대로 SHA 고정.
- 최종: vitest 37케이스 그린, 베이스라인 435파일 0건 / 250~410ms.

## 1. 배경과 결정

지금은 리뷰가 전부 수동이다. `/review-code` 스킬(`.claude/skills/review-code/SKILL.md`)은
사람이 세션에서 불러야만 돈다. 이걸 자동 게이트로 만들되, **한 겹이 아니라 두 겹**으로 나눈다.

| 층 | 시점 | 수단 | 성격 |
|---|---|---|---|
| A. pre-commit | 커밋 직전 (로컬) | 규칙 기반 정적 스캐너 (LLM 없음) | 빠름·결정적·차단 |
| B. GitHub Actions | PR open/synchronize | `/review-code` (LLM 3축 + verify) | 느림·판단형·게시 |

**왜 pre-commit에 LLM을 넣지 않는가.** `/review-code`는 서브에이전트 3개(finder) +
지적 건당 verify 에이전트를 띄운다. 커밋 1회에 에이전트 7~10개, 수 분, 비결정적, 네트워크 필수다.
가벼운 LLM 1콜로 줄여도 10~40초 + 과금 + 오프라인 불가 + 같은 diff에 다른 결과가 남는다.
pre-commit의 존재 이유는 "빠르고 확실한 사전 차단"인데 LLM은 그 두 성질을 다 못 갖춘다.
20초 기다리게 만들면 결국 `--no-verify` 습관만 남는다. 애매한 판단은 B층에 넘긴다.

**전제 (중요).** 이 레포는 현재 main 직접 커밋이고 머지커밋 0건, 열려 있는 PR은 전부 dependabot이다.
따라서 **B층은 도입 직후 사실상 휴면 상태**다. 이건 결함이 아니라 의도다 —
앞으로 팀원이 합류해 PR 흐름이 생겼을 때 게이트가 이미 깔려 있게 하려는 것.
A층은 혼자 쓰는 지금도 즉시 값을 한다.

## 2. Part A — pre-commit 정적 스캐너

### 2.1 구조

```
.githooks/pre-commit              # 얇은 셸 진입점 (core.hooksPath로 등록)
scripts/precommit-review.mjs      # staged 파일 수집 → 판정 모듈 호출 → 출력/exit
src/lib/review/static-rules.ts    # 순수 판정 로직 (규칙 정의 + 매처)
src/lib/review/__tests__/static-rules.test.ts
```

기존 `src/lib/review/verdict.ts` + `__tests__` 와 동일한 패턴(순수 모듈 + 얇은 CLI)을 따른다.
CLAUDE.md의 "순수 함수는 `lib/`" 규칙에 맞고, 규칙 로직을 vitest로 직접 때릴 수 있다.

**훅 설치는 husky 없이** `.githooks/`를 레포에 커밋하고 `package.json`의 `prepare` 스크립트에서
`git config core.hooksPath .githooks`를 건다. 팀원은 `npm install`만 하면 훅이 붙는다.
의존성 추가 0개.

### 2.2 입력

`git diff --cached --name-only --diff-filter=ACMR` 로 대상 파일을 얻고,
내용은 **워킹트리가 아니라 `git show :<path>`(staged 버전)** 을 읽는다.
`git add -p`로 일부만 스테이징한 경우 워킹트리를 읽으면 커밋되지 않을 코드를 심판하게 된다.

### 2.3 규칙 초안

각 규칙은 `{ id, severity, 대상 glob, 매처, 근거(CLAUDE.md 항목), 정상패턴 }`을 갖는다.
`severity: block`은 커밋 차단, `warn`은 출력만 하고 통과.
**오탐 위험이 있는 규칙은 warn으로 시작**하고, 실제 데이터가 쌓이면 block으로 승격한다.

| ID | severity | 내용 | 현재 위반 |
|---|---|---|---|
| `SR-01` | block | `process.env.SUPABASE_SERVICE_ROLE_KEY` 참조가 `src/app/**`·`src/components/**`에 등장 (허용: `scripts/**`) | 0 |
| `SR-02` | block | `.auth.getSession()`을 인가에 사용 (`src/app/**`·`src/lib/**`, `middleware.ts` 제외) | 0 |
| `SR-03` | block | `'use client'` 파일이 `server-only` 선언 모듈을 직접 import (1홉 검사) | 0 |
| `SR-04` | block | 마이그레이션의 `for insert\|update\|all` 정책에 `with check` 없음 (select/delete는 대상 아님) | 0 |
| `SR-05` | warn | `actions.ts`의 zod 스키마에 서버 소유 필드(`user_id`·`status`·`paid_at`·`doc_hash`·`signature_meta`·`is_demo`·pdf 경로) | 미측정 |

참고 규모: `'use client'` 33개 파일, `server-only` 14개 모듈, 마이그레이션 48개.

### 2.4 오탐 방지 — 이 설계의 핵심 제약

순진한 grep으로 베이스라인을 재보니 **걸린 2건이 전부 오탐**이었다:

- `src/app/api/contracts/[id]/insights/route.ts:3` — `// service_role 금지 ...` (주석)
- `src/app/(dashboard)/settings/actions.ts:174` — `* service_role은 쓰지 않는다 ...` (주석)

즉 "규칙을 지키라고 적어둔 주석"이 규칙 위반으로 잡힌다. 마찬가지로 `0046_invoice_share_tokens.sql`은
`with check`가 없지만 **SELECT 정책**이라 애초에 해당 사항이 아니다.

따라서:
1. 매칭 전 **주석과 문자열 리터럴을 제거**한다 (TS/SQL 각각).
2. SQL 규칙은 정책 블록 단위로 파싱해 **`for` 절을 보고** 대상을 가린다.
3. **통과 기준: 현재 레포 전체에 대해 스캐너가 0건**을 내야 한다. 1건이라도 나오면 규칙이 잘못된 것이다.

### 2.5 출력과 우회

차단 시 규칙 ID·파일:라인·근거 한 줄·수정 방향을 찍고 exit 1.
마지막 줄에 `우회: git commit --no-verify (CI의 /review-code는 그대로 돕니다)`를 명시한다.
막다른 골목을 만들지 않되, 우회해도 B층이 남는다는 걸 알린다.

### 2.6 성능 목표

staged 20파일 기준 **500ms 미만**. 네트워크·LLM 없음. `npm run lint`/`test`는 넣지 않는다 —
Stop 훅(`.claude/settings.json`)이 이미 `lint + build:verify + test`를 돌리므로 중복이다.

### 2.7 검증 (TDD)

1. `static-rules.test.ts`에 규칙별 **위반 fixture(차단됨) + 정상 fixture(통과함)** 쌍을 먼저 작성 → 실패 확인
2. 규칙 구현 → 테스트 통과
3. 레포 전체 스캔 → **0건** 확인 (§2.4)
4. 일부러 위반 코드를 staged 상태로 만들어 실제 커밋이 막히는지 확인 → 되돌림

## 3. Part B — GitHub Actions에서 /review-code

### 3.1 실행 방식

`anthropics/claude-code-action@v1`의 **automation mode**를 쓴다. `prompt`를 주면 `@claude` 멘션 없이
바로 돈다. 레포 `.claude/skills/`의 스킬은 **checkout 이후** `/review-code`로 호출 가능하다
(공식 문서 "Run a skill" 항목).

`.github/workflows/review-code.yml` 로 **ci.yml과 분리**한다. lint/build/test 게이트와 수명주기가 다르고,
LLM 잡이 실패해도 CI 그린을 막지 않게 하려는 것.

```yaml
on:
  pull_request:
    types: [opened, synchronize]
permissions:
  contents: read
  pull-requests: write   # 스킬이 인라인 리뷰를 게시하므로 read로는 부족
  issues: read
  id-token: write        # 액션의 기본 GitHub App 인증에 필요
```

- `gh` CLI가 스킬 안 Bash에서 동작해야 하므로 스텝 `env`에 `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
- 스킬은 `gh api .../pulls/{pr}/reviews`로 게시한다. 자기 PR APPROVE 거부(422) 폴백은 스킬에 이미 있음.

### 3.2 반드시 필요한 게이트

- **시크릿**: 현재 이 레포의 Actions 시크릿은 **0개**(`gh secret list` → `[]`).
  `ANTHROPIC_API_KEY` 또는 `CLAUDE_CODE_OAUTH_TOKEN`(`claude setup-token`)을 추가해야 한다.
  없으면 조용히 실패하므로 **`ci.yml`의 `e2e-gate`와 같은 fail-closed 패턴**을 재사용한다
  (job-level `if`는 secrets 컨텍스트를 못 읽는다 — step env로 판정해 job output으로 넘김).
- **봇 PR 제외**: `github.event.pull_request.user.login != 'dependabot[bot]'`.
  dependabot 런에는 일반 시크릿이 주입되지 않고, 액션 자체가 bot actor를 거부한다
  (`allowed_bots`에 넣지 않는 한). 지금 이 레포의 PR은 전부 dependabot이므로 이 조건이 없으면
  **실패 알림만 계속 쌓인다.**
- **fork PR 제외**: `github.event.pull_request.head.repo.full_name == github.repository`.

### 3.3 비용 가드

- `timeout-minutes: 15`
- `claude_args: --max-turns <N>`
- `concurrency: group: review-${{ github.event.pull_request.number }}, cancel-in-progress: true`
  (푸시 연타 시 이전 런 취소)
- `paths-ignore`로 문서/마이그레이션만 바뀐 PR 스킵은 **넣지 않는다** — 마이그레이션이야말로 RLS 리뷰 대상.

### 3.4 미확인 리스크

**스킬 2단계가 `Workflow` 툴(서브에이전트 오케스트레이션)에 의존하는데, 액션 실행 환경에서
이 툴이 제공되는지 확인하지 못했다.** 없으면 스킬이 그 지점에서 멈춘다.

- 검증: 최초 1회는 테스트 PR에서 돌려 런 로그로 확인한다.
- 폴백: 사용 불가면 스킬 2단계에 "Workflow 미가용 시 3축을 순차 단일 패스로 리뷰" 분기를 추가한다.
  (스킬 원형은 유지하고 CI 전용 폴백만 덧댐)

또 하나: 액션이 findings를 PR에 게시하려면 스킬 4단계의 `gh api` 호출이 성공해야 한다.
권한·토큰이 어긋나면 결과가 **런 로그에만** 남는다. 첫 런에서 게시 성공 여부를 눈으로 확인한다.

## 4. 실행 순서

| # | 단계 | 검증 |
|---|---|---|
| 1 | `static-rules.test.ts` 작성 (규칙별 위반/정상 fixture) | 테스트 실패 확인 |
| 2 | `src/lib/review/static-rules.ts` 구현 | `npm test` 통과 |
| 3 | `scripts/precommit-review.mjs` + `.githooks/pre-commit` + `prepare` 스크립트 | 레포 전체 스캔 0건 |
| 4 | 위반 코드 staged → 커밋 시도 | 차단됨 / 되돌린 뒤 정상 커밋됨 |
| 5 | `ANTHROPIC_API_KEY`(또는 OAuth 토큰) 시크릿 등록 | `gh secret list`에 노출 |
| 6 | `.github/workflows/review-code.yml` 작성 | actionlint / YAML 파싱 |
| 7 | 테스트 브랜치 + PR 1건으로 실 검증 | 리뷰가 PR에 인라인 게시됨. Workflow 툴 가용 여부 로그 확인 |
| 8 | 폴백 필요 시 스킬 2단계 분기 추가 | 재실행 성공 |

1~4는 지금 바로 값을 하고, 5~8은 팀 합류 대비 자산이다. **4까지만 먼저 하고 멈추는 것도 유효한 선택.**

## 5. 곁가지로 발견한 것 (이 계획 범위 밖)

- `ci.yml`의 Playwright E2E 잡은 `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` 시크릿이 없어
  **지금 항상 스킵된다.** 팀 합류 전에 시크릿을 넣거나, 스킵 중이라는 사실을 문서화해야 한다.
- `commit-msg` 훅으로 conventional commits 강제도 팀 대비로는 값이 있다. 이번 범위에서는 제외.

## 6. 열린 질문

1. B층 인증을 **API 키**로 할지 **구독 OAuth 토큰**(`claude setup-token`)으로 할지.
   팀 공유 관점에선 API 키가 맞고(토큰은 발급자 개인 구독에 묶임), 비용은 API 과금으로 잡힌다.
2. `SR-05`(zod 서버 소유 필드)를 warn으로 둘지 아예 1차에서 뺄지.
3. 4단계까지만 먼저 실행할지, 8단계까지 한 번에 갈지.

## 7. 심각도 게이트 — 자동 승인 / 머지 차단 (2026-08-09 추가)

**요구**: nit·minor만 있으면 auto-approve(머지는 하지 않음). critical·major가 하나라도 있으면
승인도 머지도 없음.

### 7.1 왜 판정을 LLM에서 뺐나

기존 4단계는 LLM이 `verdict`를 보고 `event`를 골라 `gh api`로 게시했다. 규칙은 단순하지만
승인 여부를 프롬프트 준수에 맡기는 구조라, "critical이 있는데 승인" 같은 사고가 원리적으로 가능하다.
그래서 게시를 두 겹으로 쪼갰다:

| 층 | 주체 | 게시물 |
|---|---|---|
| 지적 | LLM (스킬 4단계) | 인라인 코멘트 + 요약, `event: COMMENT` (CI 한정) |
| 판정 | 코드 (`scripts/review-gate.mjs`) | 승인/차단 리뷰 1건, `APPROVE` 또는 `REQUEST_CHANGES` |

판정 함수는 `src/lib/review/verdict.ts`의 `decideGate(tally)` — `decideVerdict`를 재사용해
`Approve`가 아니면 `blocking: true`. 테스트는 `verdict.test.ts`의 `describe("decideGate")`.
CI에서는 PR에 리뷰가 2건 달린다(상세 COMMENT + 판정). 로컬 대화형 실행은 기존대로 LLM이
event까지 게시한다 — 게이트 스텝이 없기 때문.

### 7.2 fail-closed

게이트는 `if: always()`로 리뷰 스텝 실패·타임아웃과 무관하게 돈다. 스킬이 남긴
`review-verdict.json`의 `tally`를 읽고, **파일이 없거나 집계가 없으면 승인하지 않고 exit 1**.
리뷰가 완주하지 못하면 승인은 절대 나오지 않는다.

### 7.3 "절대 머지하지 않는다"의 근거 3겹

1. 잡 권한이 `contents: read` — 머지 API(`PUT /pulls/{n}/merge`)는 `contents: write`를 요구하므로
   호출 자체가 불가능하다.
2. 레포 설정 `allow_auto_merge: false` — auto-merge 기능이 꺼져 있다.
3. 스킬·게이트 스크립트 모두 `gh pr merge`를 호출하지 않고, 금지를 명시해 뒀다.

### 7.4 한계 — 지금은 "차단 신호"까지다

이 레포는 **private + 무료(User) 플랜**이라 브랜치 보호·룰셋 API가 403이다
(`Upgrade to GitHub Pro or make this repository public`). 따라서 REQUEST_CHANGES와 빨간 체크는
**권고이지 강제가 아니다** — 사람이 무시하고 머지 버튼을 누를 수 있다.

Pro로 올리거나 public으로 전환하면 다음을 켜서 강제로 바꾼다:
- 필수 상태 체크에 `/review-code` 잡 추가 (critical·major면 exit 1이라 빨강)
- "Require a pull request before merging" + "Require approvals ≥ 1"
- "Dismiss stale pull request approvals when new commits are pushed"

주의: 같은 리뷰어(여기선 `github-actions[bot]`)의 **최신 리뷰가 이전 리뷰를 덮는다.** 승인 후
새 커밋에서 critical이 나오면 게이트가 REQUEST_CHANGES를 다시 제출하므로 승인은 자동으로 무효화된다.
별도 dismiss 호출이 필요 없는 이유다. 다만 `GITHUB_TOKEN`으로 제출한 승인이 브랜치 보호의
"필수 승인 수"를 채우는지는 Pro 전환 후 실제로 확인해야 한다.

### 7.5 첫 실검증에서 드러난 것 (PR #17·#18, 2026-08-09)

게이트를 넣고 처음 돌린 두 PR은 **둘 다 fail-closed로 막혔다.** 리뷰 자체는 정확했는데
(#17 critical 3건 정확 탐지 / #18 Approve 판정) 게이트가 각각 다른 지점에서 걸렸다:

**① 판정 파일이 Node 경고로 오염됐다 (#17).** 스킬이 저장 명령에 `2>&1`을 붙여
`MODULE_TYPELESS_PACKAGE_JSON` 경고가 JSON 앞에 섞였고, `JSON.parse`가
`Unexpected token '(', "(node:1005"...`로 실패했다. → `parseVerdictJson`으로 첫 `{`~마지막 `}`만
잘라 읽도록 보강하고, 스킬 명령에 `--no-warnings` + "`2>&1` 금지"를 못박았다.

**② GITHUB_TOKEN은 기본적으로 PR을 승인할 수 없다 (#18).** 게이트가 집계를 정상적으로 읽고
`APPROVE`까지 결정했는데 `gh api`가 **HTTP 422**로 튕겼다. 원인은 레포 설정
`can_approve_pull_request_reviews: false` — Settings → Actions → General의
**"Allow GitHub Actions to create and approve pull requests"** 가 GitHub 기본값으로 꺼져 있다.
`COMMENT` 리뷰는 이 설정과 무관하게 되기 때문에, 스킬의 인라인 게시만으로는 절대 드러나지 않는다.

```bash
gh api repos/{owner}/{repo}/actions/permissions/workflow          # 현재 값 확인
gh api -X PUT repos/{owner}/{repo}/actions/permissions/workflow \
  -F can_approve_pull_request_reviews=true                        # 켜기
```

**얻은 교훈**: fail-closed는 설계대로 동작했지만 — 승인은 한 번도 새어나가지 않았다 —
"막혔다"만으로는 옳게 막힌 건지 알 수 없다. 게이트가 낸 실패는 **로그에서 사유를 확인**해야 한다.

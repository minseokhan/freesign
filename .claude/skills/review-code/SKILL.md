---
name: review-code
description: 변경 diff를 security·correctness·architecture 3축 서브에이전트로 병렬 리뷰하고, 각 지적을 verify로 거른 뒤 PR 인라인 코멘트 2층(라인별 + 전체 요약/판정)으로 게시한다. "리뷰 코드", "PR 리뷰", "차원별 리뷰", /review-code 트리거 시 사용.
---

# /review-code — 차원별 서브에이전트 병렬 코드리뷰

변경 diff를 **차원별 전문 서브에이전트로 병렬 리뷰** → **verify로 오탐 제거** → **PR 인라인 2층 게시**.
설계 근거·확장 계획은 `docs/PLAN_review-code-skill.md` 참조.

> 빌트인 `/code-review`와 다른 스킬이다. 이 스킬은 3축(security·correctness·architecture) 병렬
> 팬아웃 + PR 인라인 게시에 특화돼 있고, 자가 트리거 가능하다.

## 실행 절차

### 1. 스코프 산정 (main 에이전트)
- 인자로 PR 번호가 오면 그 PR. 없으면 `gh pr view --json number,headRefOid,headRefName` 로 현재 브랜치의 열린 PR 자동 탐지.
- **PR이 있으면**: `gh pr diff <n>` 로 diff, `gh pr view <n> --json files -q '.files[].path'` 로 변경 파일, `headRefOid` 를 인라인 앵커용 head SHA로 확보.
- **PR이 없으면 (폴백)**: `git diff HEAD` 로 로컬 diff, `git diff --name-only HEAD` 로 파일 목록. 게시하지 않고 **터미널에 4줄 인라인 포맷 + 요약**을 출력하고 그 사실을 사용자에게 알린다. (원하면 임시 PR 생성 옵션 제안)
- diff가 비어 있으면 리뷰할 것이 없다고 알리고 종료.

**루브릭 로드 (필수)**: 리뷰 규칙은 이 파일에 적지 않는다. 규칙 정본은 `.claude/rules.json`이고,
축별 프롬프트 조각은 CLI가 생성한다:

```bash
npm run review:rubric --silent > rubric.json   # scripts/review-rubric.mjs — {security, correctness, architecture}
```
> 규칙을 프롬프트에 손으로 옮기면 정본과 갈라진다. 실제로 보안 개선에서 추가한 CRITICAL 3개
> (`webhook-secret-boundary`·`definer-rpc-scope`·`cron-review-gate`)가 이 스킬에만 빠져 있었고,
> 그 경계를 깨는 PR을 리뷰가 통과시킬 수 있었다. 지금은 `evals/harness/rules-sync.test.ts`가
> 정본↔각 층의 드리프트를 `npm test`에서 막는다.

### 2. 병렬 리뷰 실행

**인자에 `--ci`가 있거나 `$GITHUB_ACTIONS`가 설정돼 있으면 Workflow 툴을 쓰지 말 것.**
Workflow는 백그라운드로 돌면서 완료 시 에이전트를 다시 깨우는데, 헤드리스(GitHub Actions
SDK) 실행에서는 메인 에이전트가 더 호출할 툴이 없어지는 순간 프로세스가 끝난다. 팬아웃은
시작되지만 집계·게시까지 가지 못하고 런이 `success`로 종료된다(실측: PR #16, 런 31255890684 —
"Two finders are underway. Waiting for completion."에서 그대로 끝남).

CI에서는 대신 **`Task` 서브에이전트를 한 메시지에서 병렬로** 띄운다. Task는 결과를 반환할
때까지 블로킹하므로 런이 먼저 끝나지 않는다.

1. finder 3개(`security`·`correctness`·`architecture`)를 **한 메시지에 Task 3개**로 동시 실행.
   각 프롬프트는 아래 `DIMENSIONS[].intro` + **`rubric.json`의 해당 축 문자열**(규칙 본문) +
   `finderPrompt(d)`와 동일하게 구성하고,
   결과를 `{ findings: [...] }` JSON으로만 반환하도록 지시한다(스키마 강제가 없으므로
   "JSON 외 텍스트 금지"를 명시).
2. 돌아온 findings를 모아, 각 건을 **한 메시지에 Task N개**로 동시 verify(`verifyPrompt(f)`).
   `{ confirmed, reason }` JSON만 반환하게 한다.
3. `confirmed === true`인 것만 남겨 3단계로 넘긴다.

대화형(로컬) 실행에서는 아래 Workflow 경로를 그대로 쓴다.

#### 대화형: Workflow 병렬 리뷰
아래 스크립트를 **Workflow 툴에 inline `script`로 전달**한다. (이 스킬 호출 자체가 Workflow opt-in 성립.)
`args`에 `{ pr, paths, diff, rubric }`를 넘긴다(`rubric`은 위에서 만든 `rubric.json` 객체). `diff`가 매우 크면(수천 줄) 스크래치 파일에 저장 후 경로만 넘기고 finder가 Read 하도록 프롬프트를 조정한다.

워크플로우는 **verify를 통과한 raw findings 배열**만 반환한다 (집계·판정은 3단계에서 검증된 모듈이 담당).

```js
export const meta = {
  name: 'review-code',
  description: '변경 diff를 3축 서브에이전트로 병렬 리뷰하고 verify 후 확정 findings 반환',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}

// args가 문자열로 도착할 수 있으므로 정규화 (객체/문자열 모두 안전)
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})

// 축 목록과 시선만 여기서 정한다. **규칙 본문은 `.claude/rules.json`에서 파생해 args.rubric으로 받는다.**
// 규칙을 이 파일에 직접 적으면 정본과 갈라진다(확장 시: rules.json에 axis를 단 규칙을 추가할 것).
const DIMENSIONS = [
  { key: 'security', label: '보안', intro: '당신은 매듭(한국형 프리랜서 계약/청구 SaaS)의 **보안 전문 리뷰어**다. 아래 규칙 위반만 찾아라(성능·스타일 무시).' },
  { key: 'correctness', label: '정합성', intro: '당신은 매듭의 **정합성/상태전이 전문 리뷰어**다. 아래 규칙 위반과, 특정 입력/상태에서 잘못된 결과·부분 실패만 찾아라.' },
  { key: 'architecture', label: '아키텍처', intro: '당신은 매듭의 **아키텍처/경계 전문 리뷰어**다. 아래 구조 규칙 위반만 찾아라.' },
].map((d) => ({ ...d, rules: `${d.intro}\n\n${(A.rubric || {})[d.key] || ''}` }))

if (DIMENSIONS.some((d) => !(A.rubric || {})[d.key])) {
  throw new Error('rubric이 비었다 — `npm run review:rubric`으로 .claude/rules.json에서 생성해 args.rubric으로 넘길 것')
}

const FINDING_ITEM = {
  type: 'object', additionalProperties: false,
  properties: {
    file: { type: 'string' },
    line: { type: 'integer', description: '반드시 diff에 등장한 변경/인접 라인' },
    severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
    title: { type: 'string', description: '심각도 접두사 없는 제목' },
    tldr: { type: 'string', description: '무엇이 왜 문제인지 1문장' },
    good: { type: 'string', description: '잘한 점/인정할 전제 1문장' },
    fix: { type: 'string', description: '수정 코드 스니펫(가능하면 ```suggestion 또는 diff)' },
  },
  required: ['file', 'line', 'severity', 'title', 'tldr', 'good', 'fix'],
}
const FINDINGS_SCHEMA = { type: 'object', additionalProperties: false, properties: { findings: { type: 'array', items: FINDING_ITEM } }, required: ['findings'] }
const VERDICT_SCHEMA = { type: 'object', additionalProperties: false, properties: { confirmed: { type: 'boolean' }, reason: { type: 'string' } }, required: ['confirmed', 'reason'] }

function finderPrompt(d) {
  return `${d.rules}

## 리뷰 대상 (PR #${A.pr ?? 'local'})
변경 파일: ${(A.paths || []).join(', ')}
필요하면 Read로 파일 맥락을 확인하되, **지적은 아래 diff에 등장한 라인에만** 달아라(인라인은 변경 라인에만 게시 가능). line은 그 파일의 실제 변경/인접 라인 번호.

## diff
\`\`\`diff
${A.diff || '(diff 없음)'}
\`\`\`

## 지시
- 위 축의 **실제 결함만** 보고(없으면 findings: []). 추측·취향·"더 나을 수도"류 제외, 근거는 diff/파일에서 확인 가능해야 함.
- severity: critical=데이터유출/정합성붕괴/보안뚫림, major=머지전수정필요, minor=고치면좋음, nit=사소.
- title/tldr/good/fix를 모두 채워라. fix는 구체적 코드로.`
}
function verifyPrompt(f) {
  return `당신은 회의적 검증자다. 아래 지적이 정말 실제 결함인지 반박을 시도하라. 불확실/근거약하면 confirmed=false로 편향(오탐 억제).
지적: ${f.file}:${f.line} [${f.severity}] ${f.title} — ${f.tldr}
제안수정: ${f.fix}
방법: ${f.file}을 Read로 열어 해당 라인·맥락을 직접 확인. line이 실제 변경 라인을 가리키고 지적이 코드에 부합하는지 검증.
diff(참고):
\`\`\`diff
${A.diff || ''}
\`\`\`
confirmed(bool)와 reason을 반환.`
}

phase('Find')
log(`3축 병렬 리뷰: ${DIMENSIONS.map((d) => d.key).join(', ')} · PR #${args?.pr ?? 'local'}`)

const results = await pipeline(
  DIMENSIONS,
  (d) => agent(finderPrompt(d), { label: `find:${d.key}`, phase: 'Find', schema: FINDINGS_SCHEMA }),
  (review, d) =>
    parallel(((review && review.findings) || []).map((f) => () =>
      agent(verifyPrompt(f), { label: `verify:${d.key}:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then((v) => ({ ...f, dimension: d.key, verdict: v }))
    ))
)

const confirmed = results.flat().filter(Boolean).filter((f) => f.verdict && f.verdict.confirmed)
log(`확정 ${confirmed.length}건`)
return { findings: confirmed }
```

### 3. 집계·판정 (검증된 모듈)
워크플로우가 돌려준 `findings`를 스크래치 파일 `findings.json`에 저장한 뒤:

```bash
cat findings.json | node --no-warnings --experimental-strip-types src/lib/review/verdict.ts > review-verdict.json
cat review-verdict.json
```
> **저장 명령에 `2>&1`을 붙이지 말 것.** Node 경고(`MODULE_TYPELESS_PACKAGE_JSON`)가 JSON에 섞여
> 판정 파일이 깨진다. 실제 CI에서 이것 때문에 게이트가 집계를 못 읽고 fail-closed 됐다.
> (게이트가 앞뒤 노이즈를 잘라내도록 보강했지만, 원인 자체를 만들지 말 것.)

이 CLI가 **병합 → severity 정렬 → 집계 → 판정**을 수행해 `{ verdict, tally, findings }` JSON을 반환한다.
(로직은 `src/lib/review/verdict.ts`, 테스트는 `src/lib/review/__tests__/verdict.test.ts`.)

**`--ci`에서는 반드시 레포 루트 `review-verdict.json`에 저장할 것.** 워크플로의 심각도 게이트
스텝(`scripts/review-gate.mjs`)이 이 파일의 `tally`만 보고 승인/차단을 결정한다. 파일이 없거나
집계가 없으면 fail-closed로 **승인 없이 체크가 실패**한다. 지적이 0건이어도 파일은 남겨야 한다.

**병합(mergeFindings)**: ① 같은 `(file, line)`을 차원 무관하게 하나로(→ `dimensions[]`에 축 합침, 최고 심각도 채택), ② 인접 라인(±2)이면서 title 유사(토큰 자카드≥0.3)면 하나로 — finder들이 같은 이슈를 살짝 다른 라인/축으로 잡는 노이즈를 줄인다. 서로 다른 주제(유사도 낮음)는 안 합침. 반환 finding에는 `dimensions: string[]`가 붙는다.
> 한계: 한국어 활용형 차이로 유사도가 낮게 나오면 진짜 같은 이슈도 인접 코멘트 2개로 남을 수 있다(형태소 분석 미도입). 임계값을 낮추면 서로 다른 이슈를 오병합할 위험이 커지므로 0.3 고정.

판정 규칙: `critical≥1 → Blocked · major≥1 → Changes Requested · else Approve`.

### 4. 게시 — PR 인라인 2층
심각도 아이콘: 🔴 critical · 🟠 major · 🟡 minor · ⚪ nit

**GitHub review 한 번**으로 요약(body) + 인라인(comments) + 판정(event)을 함께 게시한다:

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/reviews \
  -f commit_id='<headSha>' \
  -f event='<APPROVE|REQUEST_CHANGES|COMMENT>' \
  -f body='<요약 마크다운>' \
  -F 'comments[][path]=...' -F 'comments[][line]=...' -F 'comments[][body]=...'
```
> 실무상 comments 배열이 여러 개면 `--input -` 로 JSON payload를 stdin 전달하는 편이 안전하다.

**event 매핑**: Approve→`APPROVE` · Changes Requested/Blocked→`REQUEST_CHANGES`.
**`--ci`에서는 예외 — 항상 `event: COMMENT`로만 게시한다.** 승인·차단은 워크플로의 심각도 게이트
스텝이 `decideGate`로 판정해 별도 리뷰로 제출한다(LLM이 승인 여부를 정하지 않게 하려는 것).
**절대 머지하지 말 것**: `gh pr merge`·auto-merge 활성화는 어떤 판정에서도 금지다. 승인은 사람이
머지 버튼을 누를 수 있게 해 줄 뿐이다.
**폴백**: 자기 PR이라 APPROVE/REQUEST_CHANGES가 거부되면(422) `event: COMMENT`로 재시도.
**앵커**: `path`+`line`은 diff에 등장한 라인이어야 게시된다. diff 밖 라인을 가리키는 finding은 인라인에서 제외하고 요약의 "주요 지적"에만 넣는다.

**인라인 코멘트 body 포맷 (병합된 finding 1개당):** `{icon}`은 severity 아이콘, `{dims}`는 `dimensions`를 `/`로 연결.
```
{icon} **[{severity}] {title}**  ·  _{dims}_
**TL;DR**: {tldr}
**Good**: {good}

**Fix**:
```ts
{fix}
```
```
> 게시 payload는 `--input <json>`으로 stdin 전달(코멘트 다수·코드블록·개행 안전). `comments[]` 각 항목은 `{path, line, side:"RIGHT", body}`.

**요약 body 포맷 (review body 1개):**
```markdown
## /review-code — {verdict}

**심각도 집계**: 🔴 {critical} · 🟠 {major} · 🟡 {minor} · ⚪ {nit}

**Walkthrough**: {이 변경이 무엇을 하고 리뷰가 어디에 집중했는지 2~3줄}

**잘된 점**: {눈에 띄는 좋은 결정 1~2개}

**주요 지적 (critical/major만)**:
- 🔴 `path:line` — {title}
- 🟠 `path:line` — {title}

**다음 액션**: {머지 전 반드시 고칠 것 / 확인 후 재리뷰}

<sub>3축(security·correctness·architecture) · verify 1표 · 확장축(perf/test/privacy 등) 미포함</sub>
```

### 5. 마무리
게시 후 사용자에게 PR review URL과 판정·집계를 1~2줄로 보고한다. 폴백(터미널 출력·COMMENT 강등)이 발동했으면 그 사실을 명시한다.

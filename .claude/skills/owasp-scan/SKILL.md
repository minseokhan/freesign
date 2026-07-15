---
name: owasp-scan
description: OWASP Top 10:2025 기준으로 코드베이스를 보안 스캔한다. A01-A10 카테고리별 전문 서브에이전트를 병렬로 팬아웃해 취약점을 찾고, 각 지적을 verify로 오탐 제거한 뒤 심각도·카테고리 커버리지·수정방안을 담은 HTML 대시보드(Artifact)로 보고한다. 범용 OWASP 체크에 더해 Next.js+Supabase 스택이 감지되면 RLS·service_role·zod allowlist 등 스택 특화 규칙도 점검한다. "보안 스캔", "OWASP 스캔", "취약점 점검", "security scan", "security audit", /owasp-scan 트리거 시, 또는 사용자가 코드의 보안 취약점을 전반적으로 점검·감사해달라고 할 때 반드시 사용.
---

# /owasp-scan — OWASP Top 10:2025 병렬 보안 스캔

코드베이스를 **OWASP 카테고리별 전문 서브에이전트로 병렬 스캔** → **2단계 verify로 오탐 제거**(critical/high는 추가 adversarial 패널) → **HTML 대시보드로 보고**.
카테고리별 점검 항목은 `references/owasp-2025-checks.md`에 정리돼 있다(범용 + Next.js/Supabase 스택 특화).

> 빌트인 `/security-review`(변경 diff 취약점 리뷰)와 다르다. 이 스킬은 OWASP 10개 축을 **전체 코드베이스**에 병렬
> 팬아웃하고 결과를 **대시보드로 시각화**하는 데 특화돼 있다. `--diff`로 변경분만 스캔할 수도 있다.

## 실행 절차

### 1. 스코프·스택 산정 (main 에이전트)
- **범위**: 기본은 **전체 코드베이스**. 인자에 `--diff`가 오면 `git diff HEAD`(+`git diff --name-only HEAD`)로 변경분만 스캔한다. `--diff`인데 변경이 없으면 알리고 종료.
- **스택 감지**: `package.json`에 `next`+`@supabase/ssr`(또는 `@supabase/supabase-js`)가 있으면 스택 특화 체크를 켠다(`stack: ["Next.js","Supabase"]`). 없으면 범용 OWASP 체크만 적용.
- **컨텍스트 수집**: `git rev-parse --short HEAD`로 커밋, 레포 루트 경로, 대상 파일 규모를 파악한다. 소스가 방대하면(수천 파일) finder가 자기 카테고리 패턴 위주로 Grep 탐색하도록 유도한다.
- **카탈로그 경로**: 이 스킬 디렉터리의 `references/owasp-2025-checks.md` **절대경로**를 확정해 Workflow에 넘긴다(finder가 Read해서 자기 섹션 체크를 참조).

### 2. Workflow 병렬 스캔 실행
아래 스크립트를 **Workflow 툴에 inline `script`로 전달**한다. (이 스킬 호출 자체가 Workflow opt-in 성립.)
`args`에 `{ scope, target, catalogPath, stack, diff, paths }`를 넘긴다. `diff`가 매우 크면 스크래치 파일에 저장 후 경로만 넘기고 finder가 Read 하도록 프롬프트를 조정한다.

워크플로우는 **verify를 통과한 raw findings 배열**만 반환한다(집계·시각화는 3단계 대시보드가 담당).

**2단계 검증**: 모든 발견은 1차 회의적 verify 1표를 받고(탈락 시 제거), **critical/high로 남은 것만** 서로 다른 각도의 adversarial 렌즈 2개(익스플로잇 가능성 · 기존 방어/severity 과장)를 추가로 통과해야 한다. 두 렌즈가 모두 반박하면 탈락, 하나만 반박하면 유지하되 confidence를 `plausible`로 강등(대시보드에 "추정" 배지로 표시), 둘 다 통과하면 `confirmed`. medium/low는 1차 verify만 적용해 비용을 아낀다.

```js
export const meta = {
  name: 'owasp-scan',
  description: 'OWASP Top 10:2025 카테고리별 서브에이전트로 코드베이스를 병렬 스캔하고 verify 후 확정 findings 반환',
  phases: [{ title: 'Scan' }, { title: 'Verify' }],
}

const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const STACK = (A.stack && A.stack.length) ? A.stack.join(' + ') : '(스택 특화 없음 — 범용 체크만)'

// OWASP Top 10:2025. 상세 체크는 catalogPath의 해당 섹션에 있다.
const CATEGORIES = [
  { id: 'A01', name: 'Broken Access Control' },
  { id: 'A02', name: 'Security Misconfiguration' },
  { id: 'A03', name: 'Software Supply Chain Failures' },
  { id: 'A04', name: 'Cryptographic Failures' },
  { id: 'A05', name: 'Injection' },
  { id: 'A06', name: 'Insecure Design' },
  { id: 'A07', name: 'Authentication Failures' },
  { id: 'A08', name: 'Software or Data Integrity Failures' },
  { id: 'A09', name: 'Security Logging and Alerting Failures' },
  { id: 'A10', name: 'Mishandling of Exceptional Conditions' },
]

const FINDING_ITEM = {
  type: 'object', additionalProperties: false,
  properties: {
    category: { type: 'string', description: 'A01~A10' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    title: { type: 'string', description: '심각도 접두사 없는 한 줄 제목' },
    file: { type: 'string', description: '레포 루트 기준 상대경로' },
    line: { type: 'integer', description: '해당 파일의 실제 라인(모르면 생략)' },
    evidence: { type: 'string', description: '문제를 보여주는 실제 코드/설정 스니펫' },
    impact: { type: 'string', description: '악용 시 무슨 일이 벌어지는가(1~2문장)' },
    remediation: { type: 'string', description: '구체적 수정 방안' },
    scope_tag: { type: 'string', enum: ['generic', 'stack'], description: '범용 OWASP인지 스택 특화 규칙인지' },
    freesign_rule: { type: 'string', description: '스택 규칙일 때 관련 아키텍처 규칙(선택)' },
  },
  required: ['category', 'severity', 'title', 'file', 'impact', 'remediation', 'scope_tag'],
}
const FINDINGS_SCHEMA = { type: 'object', additionalProperties: false, properties: { findings: { type: 'array', items: FINDING_ITEM } }, required: ['findings'] }
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    keep: { type: 'boolean', description: '실제 결함이면 true, 오탐/근거약이면 false' },
    confidence: { type: 'string', enum: ['confirmed', 'plausible'], description: '코드로 확인되면 confirmed, 정황상 유력하나 미확정이면 plausible' },
    reason: { type: 'string' },
  },
  required: ['keep', 'confidence', 'reason'],
}

function finderPrompt(c) {
  const scopeBlock = A.scope === 'diff'
    ? `## 대상: 변경 diff만
변경 파일: ${(A.paths || []).join(', ')}
아래 diff에 등장한 코드에서만 결함을 찾아라(맥락 확인용으로 Read는 가능).
\`\`\`diff
${A.diff || '(diff 없음)'}
\`\`\``
    : `## 대상: 전체 코드베이스 (${A.target || '.'})
Grep/Glob/Read로 이 카테고리와 관련된 파일·패턴을 능동적으로 탐색하라. 카탈로그가 준 구체 패턴(예: getSession, service_role, dangerouslySetInnerHTML, .rpc(, using (, with check)을 grep 시작점으로 삼아라. 마이그레이션 SQL·라우트 핸들러·Server Action·설정 파일을 우선 훑어라.`

  return `당신은 **OWASP ${c.id} (${c.name})** 전문 보안 스캐너다. 이 카테고리의 결함**만** 찾아라(다른 축은 무시).

## 점검 항목
\`${A.catalogPath}\` 파일을 Read해서 **${c.id} 섹션**을 정독하라. 대상 스택: ${STACK}.
스택이 감지됐으면 "스택 추가 체크"까지 적용하고, 아니면 "범용 체크"만 적용한다(scope_tag로 구분).

${scopeBlock}

## 지시
- **실제 결함만** 보고하라(없으면 findings: []). 추측·취향·"더 나을 수도"류 제외. 근거(evidence)는 코드/설정에서 실제로 확인 가능해야 한다.
- severity 기준(카탈로그 하단 참조): critical=즉시 악용(데이터유출·인가우회·RCE·service_role노출), high=릴리스 전 필수수정, medium=하드닝필요(방어선1개남음), low=심층방어 개선, info=관찰.
- file은 레포 루트 기준 상대경로, line은 실제 라인. scope_tag는 generic/stack. 스택 규칙이면 freesign_rule에 관련 규칙을 적어라.
- impact와 remediation을 반드시 채워라. remediation은 구체적으로(무엇을 어떻게 고치는지).`
}

function verifyPrompt(f) {
  return `당신은 회의적 보안 검증자다. 아래 지적이 정말 실제 취약점인지 반박을 시도하라. 오탐을 강하게 억제하라 — 근거가 약하거나 코드로 확인 안 되면 keep=false.
지적: [${f.category}/${f.severity}] ${f.title}
위치: ${f.file}${f.line ? ':' + f.line : ''}
근거: ${f.evidence || '(없음)'}
영향: ${f.impact}
방법: ${f.file}을 Read로 열어 해당 코드·맥락을 직접 확인하라. 실제로 그 결함이 존재하는지, 이미 다른 곳에서 방어되고 있지는 않은지, severity가 과장되지 않았는지 검증.
- 코드로 명확히 확인되면 keep=true, confidence=confirmed.
- 정황상 유력하나 단정 못 하면 keep=true, confidence=plausible.
- 오탐/이미 방어됨/근거 부족이면 keep=false.
keep(bool)·confidence·reason을 반환.`
}

// critical/high 전용 2차 adversarial 렌즈 — 서로 다른 각도에서 반박 시도(관점 분리)
const ADV_LENSES = [
  { key: 'exploit', focus: `**익스플로잇 가능성** 관점에서 반박하라. 이 결함으로 이어지는 구체적 공격 경로(도달 방법·전제조건·PoC)를 실제로 세울 수 있는가? 세울 수 없거나 실제 도달이 불가능하면 keep=false. 이론상 결함이지만 악용 창이 없으면 반박된 것이다.` },
  { key: 'mitigated', focus: `**기존 방어·severity 과장** 관점에서 반박하라. 이 결함이 이미 다른 계층(RLS, 프레임워크 기본 동작, 상위 미들웨어, 플랫폼(Vercel 등), 인증 게이트)에서 방어되고 있지 않은가? severity가 실제 영향보다 부풀려지지 않았는가? 이미 방어되거나 과장이면 keep=false.` },
]
function advPrompt(f, lens) {
  return `당신은 critical/high 지적을 **이중 검증**하는 회의적 보안 검증자다. 아래는 1차 검증을 통과한 고위험 지적이다. ${lens.focus}
지적: [${f.category}/${f.severity}] ${f.title}
위치: ${f.file}${f.line ? ':' + f.line : ''}
근거: ${f.evidence || '(없음)'}
영향: ${f.impact}
방법: ${f.file}을 Read로 직접 확인하라. 반박이 서면 keep=false, 반박이 실패하면(진짜 고위험이면) keep=true·confidence=confirmed.
keep(bool)·confidence·reason을 반환.`
}

// 2단계 검증: 전 항목 1차 verify → critical/high는 추가 adversarial 패널(관점 분리 2표)
async function verifyFinding(f, c) {
  const base = await agent(verifyPrompt(f), { label: `verify:${c.id}:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA })
  if (!base || !base.keep) {
    return { ...f, verdict: { keep: false, confidence: 'plausible', reason: (base && base.reason) || '1차 검증 탈락' } }
  }
  const loud = f.severity === 'critical' || f.severity === 'high'
  if (!loud) return { ...f, verdict: base }

  const panel = (await parallel(ADV_LENSES.map((L) => () =>
    agent(advPrompt(f, L), { label: `adv:${c.id}:${L.key}:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA })
  ))).filter(Boolean)
  const refuters = panel.filter((v) => !v.keep)
  if (refuters.length >= 2) {
    // 2개 렌즈 모두 반박 → 탈락
    return { ...f, verdict: { keep: false, confidence: 'plausible', reason: '2차 adversarial 패널 전원 반박: ' + refuters.map((v) => v.reason).join(' / ') } }
  }
  // 1개 반박 → contested로 유지·강등(plausible), 0개 → confirmed 유지
  const confidence = refuters.length === 0 ? 'confirmed' : 'plausible'
  const note = refuters.length ? ` [2차 패널 1/2 반박: ${refuters[0].reason}]` : ' [2차 패널 전원 통과]'
  return { ...f, verdict: { keep: true, confidence, reason: (base.reason || '') + note } }
}

phase('Scan')
log(`OWASP 10개 카테고리 병렬 스캔 · 범위: ${A.scope === 'diff' ? '변경 diff' : '전체'} · 스택: ${STACK}`)

const results = await pipeline(
  CATEGORIES,
  (c) => agent(finderPrompt(c), { label: `scan:${c.id}`, phase: 'Scan', schema: FINDINGS_SCHEMA }),
  (review, c) =>
    parallel(((review && review.findings) || []).map((f) => () =>
      verifyFinding({ ...f, category: f.category || c.id }, c)
    ))
)

const confirmed = results.flat().filter(Boolean)
  .filter((f) => f.verdict && f.verdict.keep)
  .map((f) => ({
    category: f.category, severity: f.severity, title: f.title,
    file: f.file, line: f.line, evidence: f.evidence, impact: f.impact,
    remediation: f.remediation, scope_tag: f.scope_tag, freesign_rule: f.freesign_rule,
    confidence: f.verdict.confidence,
  }))
log(`확정 ${confirmed.length}건`)
return { findings: confirmed }
```

### 3. 대시보드 생성·게시
워크플로우가 돌려준 `findings`에 메타를 붙여 스크래치 파일 `owasp-findings.json`으로 저장한다:

```json
{
  "meta": { "target": "<레포명>", "scope": "full|diff", "stack": ["Next.js","Supabase"],
            "generated": "<오늘 날짜>", "commit": "<short SHA>" },
  "findings": [ ...워크플로우 반환 배열... ]
}
```

번들 스크립트로 self-contained HTML 대시보드를 만든다(경로는 이 스킬 디렉터리 기준):

```bash
python3 scripts/build_dashboard.py <스크래치>/owasp-findings.json --out <스크래치>/owasp-dashboard.html
```

이 스크립트는 findings를 받아 **판정 배너 → 심각도 타일 → OWASP 커버리지 그리드 → 카테고리별 상세**를 담은
라이트/다크 테마 대응 HTML을 생성한다(Artifact가 감쌀 수 있도록 래퍼 태그 없이 `<style>`+마크업만 출력).

그다음 **Artifact 툴로 게시**한다:
- 게시 전 `artifact-design` 스킬을 로드해 디자인 기준을 확인한다(대시보드 디자인은 스크립트에 이미 반영돼 있으니 빠르게 통과).
- `Artifact({ file_path: "<스크래치>/owasp-dashboard.html", description: "OWASP Top 10:2025 보안 스캔 결과", favicon: "🛡️" })`.

### 4. 마무리
게시 후 사용자에게 **Artifact URL + 판정 + 심각도 집계(critical/high/medium/low/info)**를 2~3줄로 보고한다.
critical/high가 있으면 상위 1~2건을 `file:line — title`로 짚어준다. `--diff` 모드였거나 스택 특화 체크가 꺼졌으면 그 사실을 명시한다.

> 자동 스캔은 완전하지 않다. 대시보드 하단에도 명시하듯, 특히 인가·비즈니스 로직 결함은 수동 검토가 필요함을 덧붙인다.

// CI 실패 자동 수정(oncall) — 순수 로직. 워크플로 밖에서 테스트한다.
//
// 이 모듈이 판정하는 것은 세 가지다.
//   1. 깨어날 것인가        — decideOncall (봇·포크·oncall 브랜치·연쇄 트리거는 건너뛴다)
//   2. 무엇을 내보낼 것인가 — checkPatchPaths / renderPrBody (하네스 자가수정 차단 + 마스킹)
//   3. 무엇을 가릴 것인가   — redact (로그·PR 본문의 시크릿)
//
// review-code의 심각도 게이트와 같은 원칙: **판정은 LLM이 아니라 코드가 내린다.**
// 에이전트는 근본 원인과 수정만 제안하고, 대응 여부·게시 형태는 여기서 정한다.

export interface WorkflowRunFacts {
  conclusion: string | null; // 실패한 런의 결론 (failure 일 때만 대응)
  event: string; // 그 런을 촉발한 이벤트 (push · pull_request · workflow_run …)
  headBranch: string;
  headRepo: string; // 실패한 런의 head 저장소 full_name
  repo: string; // 이 저장소 full_name
  actor: string;
  triggeringActor: string;
}

export interface Decision {
  respond: boolean;
  reason: string;
}

export const ONCALL_BRANCH_PREFIX = "oncall/ci-fix-";

// 에이전트가 고칠 수 없는 경로. 무한루프 게이트(oncall 워크플로)와 자동 머지 금지 경계
// (잡 permissions)가 여기 들어 있어서, 자기 가드레일을 스스로 손보게 두면 사람 게이트가
// "초록불 PR을 대충 머지"하는 한 번의 실수로 통째로 무너진다. CI 설정 자체가 깨졌다면
// 사람이 고친다.
export const BLOCKED_PATCH_PREFIXES = [".github/", ".claude/", ".githooks/"] as const;

function isBot(login: string): boolean {
  return login.endsWith("[bot]");
}

// 대응 여부 판정. 판단에 필요한 사실이 하나라도 비어 있으면 대응하지 않는다(fail-closed) —
// 놓친 실패는 사람이 보지만, 잘못 깨어난 에이전트는 PR을 스팸하거나 루프를 돈다.
export function decideOncall(f: WorkflowRunFacts): Decision {
  if (f.conclusion !== "failure") {
    return { respond: false, reason: `실패한 런이 아닙니다 (conclusion=${f.conclusion}).` };
  }
  if (!f.headBranch || !f.headRepo || !f.repo || !f.actor || !f.triggeringActor) {
    return { respond: false, reason: "런 정보가 비어 있어 판정할 수 없습니다 (fail-closed)." };
  }
  if (isBot(f.actor) || isBot(f.triggeringActor)) {
    return { respond: false, reason: `봇이 트리거한 실패입니다 (${f.actor}/${f.triggeringActor}).` };
  }
  if (f.headRepo !== f.repo) {
    return { respond: false, reason: `포크(${f.headRepo})가 트리거한 실패입니다.` };
  }
  if (f.headBranch.startsWith(ONCALL_BRANCH_PREFIX)) {
    return { respond: false, reason: `oncall 수정 브랜치(${f.headBranch})의 실패입니다 — 루프 차단.` };
  }
  if (f.event === "workflow_run") {
    return { respond: false, reason: "workflow_run이 트리거한 실패입니다 — 연쇄 차단." };
  }
  return { respond: true, reason: `${f.headBranch}의 CI 실패에 대응합니다.` };
}

// 같은 커밋의 같은 사고에는 항상 같은 브랜치 이름이 나온다 — 재시도해도 PR이 겹쳐 열리지 않는다.
export function oncallBranch(headSha: string): string {
  return `${ONCALL_BRANCH_PREFIX}${headSha.slice(0, 7)}`;
}

// ── 시크릿 마스킹 ─────────────────────────────────────────────────────
// GitHub은 등록된 시크릿을 로그에서 ***로 가리지만, 조합해 만든 값·서드파티 도구가 뱉은
// 값·에러 메시지에 실린 자격증명은 그대로 나온다. 로그를 에이전트에 넣기 전과 PR 본문을
// 게시하기 전, 두 번 통과시킨다.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, "[REDACTED]"], // Anthropic
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED]"], // GitHub 토큰
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED]"],
  [/\bsb(?:p|_secret|_publishable)?_[A-Za-z0-9_-]{20,}/g, "[REDACTED]"], // Supabase
  [/\bre_[A-Za-z0-9_-]{20,}/g, "[REDACTED]"], // Resend
  [/\bwhsec_[A-Za-z0-9_-]{10,}/g, "[REDACTED]"], // Polar webhook
  [/\bpolar_[A-Za-z0-9_-]{20,}/g, "[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED]"], // JWT
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer [REDACTED]"],
  // URL 자격증명: 호스트는 남긴다(원인 파악에 필요), 사용자·비밀번호만 지운다.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@]+@/gi, "$1[REDACTED]@"],
  // KEY=VALUE 형태의 이름 기반 마스킹 (위 패턴에 안 걸리는 자체 시크릿용)
  [
    /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*("[^"\n]*"|'[^'\n]*'|[^\s,;)}\]]+)/g,
    "$1=[REDACTED]",
  ],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

// CI 로그는 수만 줄이 나온다. 실패 원인은 거의 항상 끝에 있으므로 꼬리만 남긴다.
export function truncateLog(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  const dropped = lines.length - maxLines;
  return [`… 앞부분 ${dropped}줄 생략 (마지막 ${maxLines}줄만 표시) …`, ...lines.slice(-maxLines)].join("\n");
}

export interface PatchCheck {
  ok: boolean;
  empty: boolean;
  blocked: string[];
}

export function checkPatchPaths(paths: string[]): PatchCheck {
  if (paths.length === 0) return { ok: false, empty: true, blocked: [] };
  const blocked = paths.filter((p) => BLOCKED_PATCH_PREFIXES.some((prefix) => p.startsWith(prefix)));
  return { ok: blocked.length === 0, empty: false, blocked };
}

export interface OncallReport {
  title?: string;
  rootCause?: string;
  fix?: string;
  unresolved?: string;
}

// 에이전트가 남긴 리포트 파일 파서. 리다이렉트로 저장하면 Node 경고가 JSON 앞뒤에 섞여
// 파싱이 깨진다(review-verdict.json에서 실제로 겪은 사고). 첫 '{' ~ 마지막 '}'만 잘라 읽는다.
export function parseReportJson(text: string): OncallReport {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("JSON 객체를 찾지 못했습니다");
  return JSON.parse(text.slice(start, end + 1));
}

export interface PrBodyInput {
  report: OncallReport;
  runId: string;
  runUrl: string;
  headSha: string;
  headBranch: string;
  files: string[];
  verified: boolean;
  // ONCALL_PAT으로 밀었으면 PR에 CI·리뷰 체크가 정상적으로 붙는다. GITHUB_TOKEN으로 밀면
  // GitHub이 워크플로를 트리거하지 않아 체크가 하나도 안 붙는다 — 사람이 그 사실을 알아야 한다.
  ciAttached: boolean;
}

const NOT_STATED = "_에이전트가 남기지 않음_";

export function renderPrBody(input: PrBodyInput): string {
  const { report, runId, runUrl, headSha, headBranch, files, verified, ciAttached } = input;
  const verdict = verified
    ? "✅ 수정 후 lint·build·test 재실행 **통과**"
    : "❌ 수정 후 lint·build·test 재실행 **실패** — 부분 수정이거나 원인이 더 있습니다";
  const ciNote = ciAttached
    ? "- 이 PR에는 `CI`·`Code Review` **체크가 붙습니다** — 머지 전에 그 결과를 보세요. 위 재검증은 체크가 뜨기 전 수정 잡 안에서 미리 돌린 것입니다."
    : "- ⚠️ 이 브랜치는 `GITHUB_TOKEN`으로 푸시돼 **PR에 CI 체크가 붙지 않습니다**(GitHub 사양). 위 재검증이 유일한 근거입니다 — `ONCALL_PAT` 시크릿을 등록하면 체크가 정상적으로 붙습니다.";

  const body = `## 🚨 CI 실패 자동 수정 (oncall)

\`CI\`가 실패해 oncall 에이전트가 실패 잡 로그를 읽고 연 PR입니다.
**자동 머지하지 않습니다 — 사람이 확인하고 머지하세요.**

| 항목 | 값 |
| --- | --- |
| 실패한 런 | [#${runId}](${runUrl}) |
| 실패 커밋 | \`${headSha.slice(0, 7)}\` (\`${headBranch}\`) |
| 재검증 | ${verdict} |

### 무엇이 깨졌나
${report.title || NOT_STATED}

### 왜 깨졌나
${report.rootCause || NOT_STATED}

### 어떻게 고쳤나
${report.fix || NOT_STATED}

### 변경 파일
${files.map((f) => `- \`${f}\``).join("\n") || "_없음_"}

### 남은 위험 · 사람이 확인할 것
${report.unresolved || NOT_STATED}

---
<sub>

${ciNote}
- 로그와 이 본문은 시크릿 패턴 마스킹을 거쳤습니다.
- 에이전트는 프로덕션(원격 DB·배포)에 대해 읽기 전용이며, \`${BLOCKED_PATCH_PREFIXES.join("\`·\`")}\` 는 수정할 수 없습니다.

</sub>
`;

  // 마지막 관문: 에이전트가 리포트에 실어 보낸 값도 반드시 마스킹을 거쳐 나간다.
  return redact(body);
}

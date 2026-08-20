// 프로젝트 CRITICAL 규칙의 기계 판독 정본(`.claude/rules.json`) 파서와 층별 파생 로직.
// 순수 함수만 둔다(파일 읽기는 호출부 — scripts/review-rubric.mjs·evals/harness).
//
// 왜 필요한가: 규칙은 CLAUDE.md에 산문으로 있는데, 실행 층마다 형태가 달라 사본이 늘었다
// (정규식 스캐너·리뷰 프롬프트·eval 루브릭). 사본이 갈라지면 문서에 있는 경계를 리뷰가
// 모르고 통과시킨다. 여기서 한 벌만 두고 각 층이 파생하게 한다.

export type RuleAxis = "security" | "correctness" | "architecture" | "process";
export type RuleLevel = "critical" | "major";

const AXES: RuleAxis[] = ["security", "correctness", "architecture", "process"];
const LEVELS: RuleLevel[] = ["critical", "major"];

/** 리뷰 축 프롬프트로 파생되는 축(process는 코드 리뷰 대상이 아니다). */
export const REVIEW_AXES: RuleAxis[] = ["security", "correctness", "architecture"];

export interface ProjectRule {
  /** 층을 가로지르는 규칙 키. eval 케이스 라벨·리뷰 출력이 이 값을 지목한다. */
  slug: string;
  severity: RuleLevel;
  axis: RuleAxis;
  /** 규칙 한 줄. */
  rule: string;
  /** 보충 설명(경로·예외·근거 ADR 등). */
  detail?: string;
  /** 규칙과 혼동되기 쉬운 올바른 코드 — 오탐 억제용. */
  ok_patterns?: string[];
  /** 정본 문서에 실재하는 원문 조각. 문서가 바뀌면 드리프트 테스트가 깨진다. */
  source_excerpt: string;
  /** 이 규칙을 정적으로 잡는 pre-commit 스캐너 규칙 ID. */
  static_rule_ids?: string[];
  /** 이 규칙을 재는 하네스 eval 케이스 id. */
  eval_cases?: string[];
}

export interface RulesFile {
  generated_from: string[];
  stack: string[];
  /** 문서에 없는 축 고유 휴리스틱(규칙이 아니라 리뷰 시선). */
  axis_notes?: Partial<Record<RuleAxis, string>>;
  rules: ProjectRule[];
}

const OK_HEADER = "[정상 패턴 — 위반으로 보고하지 말 것]";

function fail(message: string): never {
  throw new Error(`rules.json: ${message}`);
}

function asStringArray(value: unknown, field: string, slug: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    fail(`[${slug}] ${field}는 문자열 배열이어야 합니다.`);
  }
  return value as string[];
}

export function parseRules(input: unknown): RulesFile {
  if (typeof input !== "object" || input === null) fail("객체가 아닙니다.");
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.rules)) fail("rules 배열이 없습니다.");

  const seen = new Set<string>();
  const rules: ProjectRule[] = raw.rules.map((item, i) => {
    if (typeof item !== "object" || item === null) fail(`rules[${i}]가 객체가 아닙니다.`);
    const r = item as Record<string, unknown>;
    const slug = r.slug;
    if (typeof slug !== "string" || slug.length === 0) fail(`rules[${i}]에 slug가 없습니다.`);
    if (seen.has(slug)) fail(`slug '${slug}'가 중복입니다.`);
    seen.add(slug);

    if (typeof r.severity !== "string" || !LEVELS.includes(r.severity as RuleLevel)) {
      fail(`[${slug}] severity는 ${LEVELS.join("|")} 중 하나여야 합니다.`);
    }
    if (typeof r.axis !== "string" || !AXES.includes(r.axis as RuleAxis)) {
      fail(`[${slug}] axis는 ${AXES.join("|")} 중 하나여야 합니다.`);
    }
    if (typeof r.rule !== "string" || r.rule.length === 0) fail(`[${slug}] rule 문장이 없습니다.`);
    if (typeof r.source_excerpt !== "string" || r.source_excerpt.length === 0) {
      fail(`[${slug}] source_excerpt가 없습니다 — 문서 앵커 없이는 드리프트를 잡을 수 없습니다.`);
    }
    if (r.detail !== undefined && typeof r.detail !== "string") fail(`[${slug}] detail은 문자열이어야 합니다.`);

    return {
      slug,
      severity: r.severity as RuleLevel,
      axis: r.axis as RuleAxis,
      rule: r.rule,
      detail: r.detail as string | undefined,
      ok_patterns: asStringArray(r.ok_patterns, "ok_patterns", slug),
      source_excerpt: r.source_excerpt,
      static_rule_ids: asStringArray(r.static_rule_ids, "static_rule_ids", slug),
      eval_cases: asStringArray(r.eval_cases, "eval_cases", slug),
    };
  });

  return {
    generated_from: (asStringArray(raw.generated_from, "generated_from", "-") ?? []) as string[],
    stack: (asStringArray(raw.stack, "stack", "-") ?? []) as string[],
    axis_notes: (raw.axis_notes ?? undefined) as RulesFile["axis_notes"],
    rules,
  };
}

export function rulesForAxis(file: RulesFile, axis: RuleAxis): ProjectRule[] {
  return file.rules.filter((r) => r.axis === axis);
}

function ruleLine(r: ProjectRule): string {
  const level = r.severity === "critical" ? "CRITICAL" : "major";
  const detail = r.detail ? ` ${r.detail}` : "";
  return `[${r.slug}] (${level}) ${r.rule}${detail}`;
}

function okBlock(rules: ProjectRule[]): string {
  const lines = rules.flatMap((r) => (r.ok_patterns ?? []).map((p) => `- (${r.slug}) ${p}`));
  return lines.length === 0 ? "" : `\n\n${OK_HEADER}\n${lines.join("\n")}`;
}

/** 리뷰 스킬의 축별 finder 프롬프트 본문. */
export function buildAxisRubric(file: RulesFile, axis: RuleAxis): string {
  const rules = rulesForAxis(file, axis);
  const note = file.axis_notes?.[axis];
  const body = rules.map(ruleLine).join("\n");
  return `${body}${okBlock(rules)}${note ? `\n\n[이 축에서 함께 볼 것]\n${note}` : ""}`;
}

/** 하네스 eval review 트랙의 루브릭 본문 — CRITICAL 경계만 잰다. */
export function buildEvalRubric(file: RulesFile): string {
  const critical = file.rules.filter((r) => r.severity === "critical");
  const body = critical.map((r) => `[${r.slug}] ${r.rule}${r.detail ? ` ${r.detail}` : ""}`).join("\n");
  return `${body}${okBlock(critical)}`;
}

/** 규약 문서에서 CRITICAL 불릿만 뽑는다(명령어 주석 등 불릿 아닌 언급은 규칙이 아니다). */
export function criticalBullets(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^-\s+CRITICAL:/.test(l))
    .map((l) => l.replace(/^-\s+/, ""));
}

/** 어떤 규칙의 source_excerpt로도 앵커되지 않은 불릿 — 문서에만 있고 기계 층엔 없는 규칙. */
export function uncoveredBullets(bullets: string[], file: RulesFile): string[] {
  return bullets.filter((b) => !file.rules.some((r) => b.includes(r.source_excerpt)));
}

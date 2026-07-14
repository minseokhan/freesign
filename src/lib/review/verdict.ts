// /review-code 리뷰 결과 병합·판정 — 순수 로직 (샌드박스 워크플로우 밖에서 테스트).
// CLI 겸용: `node --experimental-strip-types src/lib/review/verdict.ts` 로 실행하면
// stdin의 { findings: Finding[] } 를 읽어 { verdict, tally, findings } 를 stdout으로 출력한다.

export type Severity = "critical" | "major" | "minor" | "nit";
export type Verdict = "Approve" | "Changes Requested" | "Blocked";

export interface Finding {
  dimension: string;
  file: string;
  line: number;
  severity: Severity;
  title: string;
  tldr: string;
  good: string;
  fix: string;
}

// 병합 후 결과: 대표 finding 필드 + 합쳐진 차원 목록.
export interface MergedFinding extends Finding {
  dimensions: string[];
}

export type Tally = Record<Severity, number>;

export interface Aggregate {
  verdict: Verdict;
  tally: Tally;
  findings: MergedFinding[];
}

export interface MergeOpts {
  window: number; // 인접 라인 병합 허용 거리 (라인 수)
  sim: number; // 인접 병합에 필요한 title 토큰 자카드 유사도 하한
}

const DEFAULT_MERGE: MergeOpts = { window: 2, sim: 0.3 };

const SEV_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2, nit: 3 };

function normTitle(t: string): string[] {
  return t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const uni = new Set([...sa, ...sb]).size;
  return uni === 0 ? 0 : inter / uni;
}

// 같은 위치(정확 라인·차원 무관) 또는 인접 라인+유사 title 을 하나로 병합.
// 대표(rep)는 심각도 최상 → 라인 최소 순으로 먼저 잡히는 finding.
export function mergeFindings(findings: Finding[], opts: MergeOpts = DEFAULT_MERGE): MergedFinding[] {
  const sorted = [...findings].sort(
    (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.line - b.line,
  );
  const clusters: { rep: Finding; dims: Set<string>; tokens: string[] }[] = [];

  for (const f of sorted) {
    const tokens = normTitle(f.title);
    let hit: (typeof clusters)[number] | undefined;
    for (const c of clusters) {
      if (c.rep.file !== f.file) continue;
      const dl = Math.abs(c.rep.line - f.line);
      if (dl === 0 || (dl <= opts.window && jaccard(c.tokens, tokens) >= opts.sim)) {
        hit = c;
        break;
      }
    }
    if (hit) hit.dims.add(f.dimension);
    else clusters.push({ rep: f, dims: new Set([f.dimension]), tokens });
  }

  return clusters.map((c) => ({ ...c.rep, dimensions: [...c.dims].sort() }));
}

export function rankBySeverity<T extends { severity: Severity; file: string; line: number }>(
  findings: T[],
): T[] {
  return [...findings].sort((a, b) => {
    const s = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
    if (s !== 0) return s;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });
}

export function tally(findings: { severity: Severity }[]): Tally {
  const t: Tally = { critical: 0, major: 0, minor: 0, nit: 0 };
  for (const f of findings) t[f.severity]++;
  return t;
}

export function decideVerdict(t: Tally): Verdict {
  if (t.critical > 0) return "Blocked";
  if (t.major > 0) return "Changes Requested";
  return "Approve";
}

export function aggregate(findings: Finding[], opts: MergeOpts = DEFAULT_MERGE): Aggregate {
  const ranked = rankBySeverity(mergeFindings(findings, opts));
  const t = tally(ranked);
  return { verdict: decideVerdict(t), tally: t, findings: ranked };
}

// ── CLI entrypoint ────────────────────────────────────────────────────
if (
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  process.argv[1].endsWith("verdict.ts")
) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    const parsed = JSON.parse(raw || "{}");
    const findings: Finding[] = Array.isArray(parsed) ? parsed : parsed.findings ?? [];
    process.stdout.write(JSON.stringify(aggregate(findings), null, 2) + "\n");
  });
}

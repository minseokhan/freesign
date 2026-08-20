// 하네스 품질 회귀 게이트 (라이브 · npm run eval).
// 골든셋을 두 트랙에서 subject→judge로 채점하고, 하나라도 fail이면 exit 1.
// 순수 로직(파서·집계·판정)은 npm test 로 키 없이 검증된다. 여기서만 네트워크·비용 발생.

import fs from "node:fs";
import path from "node:path";
import { loadCases, CASES_DIR } from "./lib/cases.ts";
import { loadProjectRules } from "./lib/rules-file.ts";
import { aggregate, formatSummary } from "./lib/aggregate.ts";
import { runReviewCase } from "./tracks/review.ts";
import { runQaCase } from "./tracks/qa.ts";
import type { RulesFile } from "../../src/lib/review/rules.ts";
import type { CaseResult, ParsedCase } from "./lib/types.ts";

const CLAUDE_MD = path.resolve(import.meta.dirname, "..", "..", "CLAUDE.md");
const CONCURRENCY = 4;

async function runCase(c: ParsedCase, claudeMd: string, rules: RulesFile): Promise<CaseResult> {
  try {
    return c.track === "review" ? await runReviewCase(c, rules) : await runQaCase(c, claudeMd);
  } catch (err) {
    // 호출·파싱 실패는 해당 케이스 fail로 처리(게이트를 뚫고 나가지 않도록).
    return {
      id: c.id,
      track: c.track,
      verdict: "fail",
      reason: `실행 오류: ${err instanceof Error ? err.message : String(err)}`,
      subjectOutput: "",
    };
  }
}

/** 동시 실행 상한을 둔 map. 순서 보존. 순수(주입된 fn에만 의존). */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const cases = loadCases(CASES_DIR);
  const claudeMd = fs.readFileSync(CLAUDE_MD, "utf8");
  const rules = loadProjectRules();

  console.log(`골든셋 ${cases.length}건 채점 시작 (동시 ${CONCURRENCY}) …`);
  const results = await mapPool(cases, CONCURRENCY, (c) => runCase(c, claudeMd, rules));
  for (const r of results) {
    console.log(`  ${r.verdict === "pass" ? "✓" : "✗"} [${r.track}] ${r.id}`);
  }

  const summary = aggregate(results);
  console.log(formatSummary(summary));
  process.exit(summary.exitCode);
}

// 엔트리로 직접 실행할 때만 채점을 돈다. 테스트가 import해도 main은 안 돈다.
if ((import.meta as { main?: boolean }).main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

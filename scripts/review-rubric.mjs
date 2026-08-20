// 리뷰 루브릭 생성 CLI — `.claude/rules.json`(규칙 정본) → 축별 프롬프트 조각.
// /review-code 스킬이 이 출력을 워크플로 args로 넘긴다. 규칙을 프롬프트에 손으로 적지 않기 위한 층.
//
//   node --experimental-strip-types scripts/review-rubric.mjs        # {security, correctness, architecture}
//   node --experimental-strip-types scripts/review-rubric.mjs security

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REVIEW_AXES, buildAxisRubric, parseRules } from "../src/lib/review/rules.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rules = parseRules(JSON.parse(readFileSync(path.join(root, ".claude", "rules.json"), "utf8")));

const axis = process.argv[2];
if (axis) {
  if (!REVIEW_AXES.includes(axis)) {
    process.stderr.write(`알 수 없는 축: ${axis} (가능: ${REVIEW_AXES.join(", ")})\n`);
    process.exit(1);
  }
  process.stdout.write(buildAxisRubric(rules, axis) + "\n");
} else {
  const out = Object.fromEntries(REVIEW_AXES.map((a) => [a, buildAxisRubric(rules, a)]));
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

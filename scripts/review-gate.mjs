// 리뷰 심각도 게이트 — /review-code가 남긴 판정 파일을 읽어 PR 리뷰를 제출한다.
//
//   critical·major 0건  → APPROVE 리뷰 제출, exit 0
//   critical·major 1건+ → REQUEST_CHANGES 리뷰 제출, exit 1 (체크 실패 = 머지 금지 신호)
//   판정 파일이 없거나 깨졌으면 → 아무것도 승인하지 않고 exit 1 (fail-closed)
//
// 이 스크립트는 **어떤 경우에도 머지하지 않는다**. `gh pr merge`·auto-merge를 호출하지 않고,
// 워크플로 권한도 `contents: read`라 머지 API 자체가 불가능하다. 승인은 사람이 머지 버튼을
// 누를 수 있게 해 줄 뿐이다.
//
// 판정 로직은 src/lib/review/verdict.ts 의 decideGate (테스트 있음). 이 파일은 입출력만 담당한다.
//
//   node --experimental-strip-types scripts/review-gate.mjs

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

import { decideGate, parseVerdictJson } from "../src/lib/review/verdict.ts";

const SEVERITIES = ["critical", "major", "minor", "nit"];

const verdictPath = process.env.REVIEW_VERDICT_PATH || "review-verdict.json";
const repo = process.env.GITHUB_REPOSITORY;
const pr = process.env.PR_NUMBER;
const headSha = process.env.HEAD_SHA;

function fail(reason) {
  console.error(`심각도 게이트 fail-closed: ${reason}`);
  console.error("승인하지 않고 체크를 실패로 남깁니다.");
  process.exit(1);
}

if (!repo || !pr) fail("GITHUB_REPOSITORY 또는 PR_NUMBER가 비어 있습니다.");

let tally;
try {
  tally = parseVerdictJson(readFileSync(verdictPath, "utf8")).tally;
} catch (err) {
  fail(`${verdictPath}를 읽지 못했습니다 (${err.message}). 리뷰가 완주하지 못한 것으로 봅니다.`);
}
if (!tally || SEVERITIES.some((s) => typeof tally[s] !== "number")) {
  fail(`${verdictPath}에 심각도 집계(tally)가 없습니다.`);
}

const { event, blocking } = decideGate(tally);
const counts = `🔴 ${tally.critical} · 🟠 ${tally.major} · 🟡 ${tally.minor} · ⚪ ${tally.nit}`;
const body = blocking
  ? `## 심각도 게이트 — 머지 금지

**심각도 집계**: ${counts}

critical/major가 남아 있어 **승인하지 않습니다**. 인라인 지적을 수정하고 다시 푸시하면 재리뷰합니다.`
  : `## 심각도 게이트 — 자동 승인

**심각도 집계**: ${counts}

minor 이하만 남아 자동 승인합니다. **머지는 자동으로 하지 않습니다** — 확인 후 직접 머지하세요.`;

try {
  execFileSync(
    "gh",
    [
      "api",
      `repos/${repo}/pulls/${pr}/reviews`,
      "-f",
      `event=${event}`,
      "-f",
      `body=${body}`,
      ...(headSha ? ["-f", `commit_id=${headSha}`] : []),
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
} catch (err) {
  fail(`리뷰 제출(${event})이 실패했습니다: ${err.message}`);
}

console.log(`심각도 게이트: ${event} 제출 · ${counts}`);

// 잡 요약에도 남긴다. 체크가 빨갛게 떴을 때 로그를 펼치지 않고 이유를 볼 수 있게.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
}

process.exit(blocking ? 1 : 0);

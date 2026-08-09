// oncall 트리거 게이트 — 깨진 CI 런에 대응할지 코드가 정한다.
//
// job-level `if`는 secrets 컨텍스트를 읽을 수 없으므로(허용: github·needs·vars·inputs)
// 이 스텝에서 판정해 job output으로 넘긴다. (ci.yml의 e2e-gate · review-code.yml의 gate와 같은 패턴)
//
// 판정 로직은 src/lib/oncall/incident.ts 의 decideOncall (테스트 있음). 이 파일은 입출력만 담당한다.
//
//   node --experimental-strip-types scripts/oncall-gate.mjs

import { appendFileSync } from "node:fs";

import { decideOncall, oncallBranch } from "../src/lib/oncall/incident.ts";

const headSha = process.env.HEAD_SHA || "";

function out(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function summary(text) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  } catch (err) {
    console.error(`잡 요약 기록 실패(무시): ${err.message}`);
  }
}

function skip(reason) {
  console.log(`oncall 건너뜀: ${reason}`);
  summary(`## oncall — 건너뜀\n\n${reason}`);
  out("enabled", "false");
  process.exit(0);
}

// 토큰이 없으면 에이전트를 띄울 수 없다. 실패 알림만 쌓이지 않게 조용히 건너뛴다.
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  skip("CLAUDE_CODE_OAUTH_TOKEN 시크릿이 없습니다.");
}
if (!headSha) {
  skip("실패한 런의 head SHA가 비어 있습니다 (fail-closed).");
}

const decision = decideOncall({
  conclusion: process.env.CONCLUSION || null,
  event: process.env.RUN_EVENT || "",
  headBranch: process.env.HEAD_BRANCH || "",
  headRepo: process.env.HEAD_REPO || "",
  repo: process.env.GITHUB_REPOSITORY || "",
  actor: process.env.ACTOR || "",
  triggeringActor: process.env.TRIGGERING_ACTOR || "",
});

if (!decision.respond) skip(decision.reason);

const branch = oncallBranch(headSha);
console.log(`oncall 대응: ${decision.reason} (수정 브랜치 ${branch})`);
summary(`## oncall — 대응\n\n${decision.reason}\n\n수정 브랜치: \`${branch}\``);
out("enabled", "true");
out("branch", branch);

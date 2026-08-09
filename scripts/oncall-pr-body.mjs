// oncall PR 본문 생성 + 패치 경로 검증 — PR을 열기 **전에** 도는 마지막 관문.
//
// 여기서 통과해야만 워크플로가 브랜치를 밀고 PR을 연다. 판정은 LLM이 아니라 코드가 한다.
//
//   exit 0 → PR 본문을 $ONCALL_BODY_PATH 에 씀. PR을 열어도 된다.
//   exit 2 → 바꾼 파일이 없다. 사고는 있었지만 에이전트가 수정을 만들지 못했다 → PR 없음.
//   exit 1 → 열면 안 된다 (하네스 자가수정 시도 · 설명 없는 수정). fail-closed.
//
// 판정 로직은 src/lib/oncall/incident.ts 의 checkPatchPaths / renderPrBody (테스트 있음).
//
//   node --experimental-strip-types scripts/oncall-pr-body.mjs

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import { checkPatchPaths, parseReportJson, renderPrBody } from "../src/lib/oncall/incident.ts";

const filesPath = process.env.ONCALL_FILES_PATH || "oncall-files.txt";
const reportPath = process.env.ONCALL_REPORT_PATH || "oncall-report.json";
const bodyPath = process.env.ONCALL_BODY_PATH || "oncall-body.md";

function summary(text) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  } catch (err) {
    console.error(`잡 요약 기록 실패(무시): ${err.message}`);
  }
}

function stop(code, heading, detail) {
  console.error(`${heading}: ${detail}`);
  summary(`## oncall — ${heading}\n\n${detail}`);
  process.exit(code);
}

const files = readFileSync(filesPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const check = checkPatchPaths(files);

if (check.empty) {
  stop(2, "수정 없음", "에이전트가 코드를 바꾸지 않았습니다. 사람이 직접 봐야 합니다.");
}
if (!check.ok) {
  stop(
    1,
    "차단된 경로",
    `에이전트가 자기 하네스를 고치려 했습니다: ${check.blocked.join(", ")}\n\n` +
      "무한루프 게이트와 자동 머지 금지 경계가 이 경로에 있어 PR을 열지 않습니다. 패치는 아티팩트로 남겨 뒀습니다.",
  );
}

let report;
try {
  report = parseReportJson(readFileSync(reportPath, "utf8"));
} catch (err) {
  stop(
    1,
    "리포트 없음",
    `${reportPath}를 읽지 못했습니다 (${err.message}). 근거 없는 수정 PR은 열지 않습니다 (fail-closed).`,
  );
}

const body = renderPrBody({
  report,
  runId: process.env.ONCALL_RUN_ID || "",
  runUrl: process.env.ONCALL_RUN_URL || "",
  headSha: process.env.ONCALL_HEAD_SHA || "",
  headBranch: process.env.ONCALL_HEAD_BRANCH || "",
  files,
  verified: process.env.ONCALL_VERIFY_STATUS === "pass",
  ciAttached: process.env.ONCALL_CI_ATTACHED === "true",
});

writeFileSync(bodyPath, body);
console.log(`PR 본문을 ${bodyPath}에 썼습니다 (${files.length}개 파일).`);

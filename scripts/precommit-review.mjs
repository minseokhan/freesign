// pre-commit 정적 리뷰 CLI — staged 변경만 훑어 CLAUDE.md CRITICAL 규칙 위반을 차단한다.
// 판정 로직은 src/lib/review/static-rules.ts (테스트 있음). 이 파일은 입출력만 담당한다.
//
//   node --experimental-strip-types scripts/precommit-review.mjs        # staged 검사 (훅)
//   node --experimental-strip-types scripts/precommit-review.mjs --all  # 레포 전체 (베이스라인)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { hasBlocking, scanFiles } from "../src/lib/review/static-rules.ts";

const SCANNABLE = /\.(ts|tsx|js|jsx|mjs|sql)$/;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// 워킹트리가 아니라 인덱스(staged) 내용을 읽는다.
// `git add -p` 로 일부만 스테이징한 경우 워킹트리를 읽으면 커밋되지 않을 코드를 심판하게 된다.
function stagedFiles() {
  const out = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]);
  return out.split("\0").filter((p) => p && SCANNABLE.test(p));
}

function readStaged(path) {
  return git(["show", `:${path}`]);
}

// 베이스라인 검증용. 추적 파일만 보면 아직 커밋되지 않은 새 파일을 건너뛰어
// 가짜 그린이 나오므로, untracked(무시 목록 제외)까지 함께 훑는다.
function allFiles() {
  const out = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return [...new Set(out.split("\0").filter((p) => p && SCANNABLE.test(p)))];
}

// `server-only` 를 선언한 모듈 목록 (SR-03이 클라이언트 import를 판정할 때 씀).
function serverOnlyModules(all) {
  const args = all
    ? ["grep", "-l", "server-only", "--", "src"]
    : ["grep", "--cached", "-l", "server-only", "--", "src"];
  try {
    return git(args)
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s && SCANNABLE.test(s));
  } catch {
    return []; // git grep은 매치가 없으면 exit 1
  }
}

const ICON = { block: "✖", warn: "⚠" };

function report(violations, fileCount, ms) {
  if (violations.length === 0) {
    process.stderr.write(`✔ pre-commit 정적 리뷰 통과 — ${fileCount}개 파일, ${ms}ms\n`);
    return;
  }

  const blocks = violations.filter((v) => v.severity === "block");
  const warns = violations.filter((v) => v.severity === "warn");
  const head = blocks.length > 0 ? "✖ pre-commit 정적 리뷰" : "⚠ pre-commit 정적 리뷰";
  process.stderr.write(`\n${head} — 차단 ${blocks.length}건 · 경고 ${warns.length}건\n\n`);

  for (const v of [...blocks, ...warns]) {
    process.stderr.write(`  ${ICON[v.severity]} ${v.ruleId}  ${v.file}:${v.line}\n`);
    process.stderr.write(`     ${v.message}\n`);
    process.stderr.write(`     → ${v.hint}\n\n`);
  }

  if (blocks.length > 0) {
    process.stderr.write("우회: git commit --no-verify (CI의 /review-code는 그대로 돕니다)\n\n");
  }
}

function main() {
  const all = process.argv.includes("--all");
  const started = Date.now();

  const paths = all ? allFiles() : stagedFiles();
  if (paths.length === 0) {
    process.exit(0);
  }

  const files = paths.map((path) => ({
    path,
    content: all ? readFileSync(path, "utf8") : readStaged(path),
  }));

  const violations = scanFiles(files, { serverOnlyModules: serverOnlyModules(all) });
  report(violations, files.length, Date.now() - started);
  process.exit(hasBlocking(violations) ? 1 : 0);
}

main();

// 채점 결과 집계 + 게이트 판정 — 순수 함수. run.ts가 이 exitCode로 종료한다.

import type { CaseResult, Summary, Track } from "./types.ts";

/** CaseResult[] → 요약. 하나라도 fail(또는 결과 0건)이면 exitCode 1. 순수. */
export function aggregate(results: CaseResult[]): Summary {
  const byTrack: Summary["byTrack"] = {
    review: { total: 0, passed: 0, failed: 0 },
    qa: { total: 0, passed: 0, failed: 0 },
  };

  let passed = 0;
  let failed = 0;
  const failures: CaseResult[] = [];

  for (const res of results) {
    const t = byTrack[res.track];
    t.total += 1;
    if (res.verdict === "pass") {
      t.passed += 1;
      passed += 1;
    } else {
      t.failed += 1;
      failed += 1;
      failures.push(res);
    }
  }

  const total = results.length;
  // 결과가 0건이면 게이트가 무의미하게 통과하지 않도록 실패로 본다.
  const exitCode: 0 | 1 = failed === 0 && total > 0 ? 0 : 1;

  return { total, passed, failed, byTrack, failures, exitCode };
}

/** 사람이 읽는 콘솔 요약 문자열. 순수(색 코드 없음, CI 로그 친화). */
export function formatSummary(summary: Summary): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("── 하네스 품질 eval 결과 ──");
  (Object.keys(summary.byTrack) as Track[]).forEach((track) => {
    const t = summary.byTrack[track];
    lines.push(`  ${track.padEnd(6)}  ${t.passed}/${t.total} pass`);
  });
  lines.push(`  합계     ${summary.passed}/${summary.total} pass`);

  if (summary.failures.length > 0) {
    lines.push("");
    lines.push("실패:");
    for (const f of summary.failures) {
      lines.push(`  ✗ [${f.track}] ${f.id} — ${f.reason}`);
    }
  }
  lines.push("");
  lines.push(summary.exitCode === 0 ? "게이트 통과 ✓" : "게이트 실패 ✗ (exit 1)");
  return lines.join("\n");
}

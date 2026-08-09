import { describe, expect, it } from "vitest";

import {
  aggregate,
  decideGate,
  decideVerdict,
  mergeFindings,
  rankBySeverity,
  tally,
  type Finding,
} from "@/lib/review/verdict";

function f(over: Partial<Finding>): Finding {
  return {
    dimension: "security",
    file: "src/app/a.ts",
    line: 1,
    severity: "minor",
    title: "t",
    tldr: "d",
    good: "g",
    fix: "x",
    ...over,
  };
}

describe("decideVerdict", () => {
  it("blocks when any critical present", () => {
    expect(decideVerdict({ critical: 1, major: 0, minor: 5, nit: 9 })).toBe("Blocked");
  });

  it("requests changes when major but no critical", () => {
    expect(decideVerdict({ critical: 0, major: 2, minor: 0, nit: 0 })).toBe("Changes Requested");
  });

  it("approves when only minor/nit", () => {
    expect(decideVerdict({ critical: 0, major: 0, minor: 3, nit: 4 })).toBe("Approve");
  });

  it("approves an empty tally", () => {
    expect(decideVerdict({ critical: 0, major: 0, minor: 0, nit: 0 })).toBe("Approve");
  });
});

describe("decideGate", () => {
  it("지적이 없으면 자동 승인하고 차단하지 않는다", () => {
    expect(decideGate({ critical: 0, major: 0, minor: 0, nit: 0 })).toEqual({
      event: "APPROVE",
      blocking: false,
    });
  });

  it("minor·nit만 있으면 개수와 무관하게 자동 승인한다", () => {
    expect(decideGate({ critical: 0, major: 0, minor: 12, nit: 30 })).toEqual({
      event: "APPROVE",
      blocking: false,
    });
  });

  it("major가 1건이라도 있으면 승인하지 않고 차단한다", () => {
    expect(decideGate({ critical: 0, major: 1, minor: 0, nit: 0 })).toEqual({
      event: "REQUEST_CHANGES",
      blocking: true,
    });
  });

  it("critical이 1건이라도 있으면 승인하지 않고 차단한다", () => {
    expect(decideGate({ critical: 1, major: 0, minor: 0, nit: 0 })).toEqual({
      event: "REQUEST_CHANGES",
      blocking: true,
    });
  });

  it("critical·major에 minor·nit가 섞여도 차단이 이긴다", () => {
    expect(decideGate({ critical: 2, major: 3, minor: 9, nit: 9 })).toEqual({
      event: "REQUEST_CHANGES",
      blocking: true,
    });
  });
});

describe("rankBySeverity", () => {
  it("orders critical > major > minor > nit, then by file, then line", () => {
    const ranked = rankBySeverity([
      f({ severity: "nit", file: "src/z.ts", line: 3 }),
      f({ severity: "critical", file: "src/b.ts", line: 10 }),
      f({ severity: "major", file: "src/a.ts", line: 5 }),
      f({ severity: "critical", file: "src/a.ts", line: 2 }),
      f({ severity: "critical", file: "src/a.ts", line: 1 }),
    ]);
    expect(ranked.map((r) => [r.severity, r.file, r.line])).toEqual([
      ["critical", "src/a.ts", 1],
      ["critical", "src/a.ts", 2],
      ["critical", "src/b.ts", 10],
      ["major", "src/a.ts", 5],
      ["nit", "src/z.ts", 3],
    ]);
  });
});

describe("mergeFindings", () => {
  it("merges same-location findings across dimensions into one, unioning dimensions and taking max severity", () => {
    const out = mergeFindings([
      f({ dimension: "security", file: "src/a.ts", line: 8, severity: "critical", title: "service_role 키 노출" }),
      f({ dimension: "correctness", file: "src/a.ts", line: 8, severity: "major", title: "service_role 키 노출" }),
      f({ dimension: "architecture", file: "src/a.ts", line: 8, severity: "critical", title: "service_role 키 노출" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("critical");
    expect(out[0].dimensions).toEqual(["architecture", "correctness", "security"]);
  });

  it("merges adjacent lines when titles are similar (finder line jitter)", () => {
    const out = mergeFindings([
      f({ file: "src/a.ts", line: 15, severity: "critical", title: "클라이언트에서 invoices 전체를 직접 조회" }),
      f({ file: "src/a.ts", line: 16, severity: "critical", title: "클라이언트에서 invoices 전체를 조회하고 필터 누락", dimension: "correctness" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].dimensions).toEqual(["correctness", "security"]);
  });

  it("does NOT merge adjacent lines with dissimilar titles", () => {
    const out = mergeFindings([
      f({ file: "src/a.ts", line: 16, severity: "critical", title: "invoices 전체 조회" }),
      f({ file: "src/a.ts", line: 17, severity: "major", title: "catch에서 실패를 조용히 삼킴", dimension: "correctness" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("does NOT merge similar titles that are beyond the line window", () => {
    const out = mergeFindings(
      [
        f({ file: "src/a.ts", line: 2, title: "원천징수 계산을 컴포넌트에서 직접 수행" }),
        f({ file: "src/a.ts", line: 40, title: "원천징수 계산을 컴포넌트에서 직접 수행" }),
      ],
      { window: 2, sim: 0.4 },
    );
    expect(out).toHaveLength(2);
  });

  it("does not merge findings in different files", () => {
    const out = mergeFindings([
      f({ file: "src/a.ts", line: 8, title: "same title" }),
      f({ file: "src/b.ts", line: 8, title: "same title" }),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("tally", () => {
  it("counts each severity bucket", () => {
    expect(
      tally([
        f({ severity: "critical" }),
        f({ severity: "critical" }),
        f({ severity: "major" }),
        f({ severity: "nit" }),
      ]),
    ).toEqual({ critical: 2, major: 1, minor: 0, nit: 1 });
  });
});

describe("aggregate", () => {
  it("merges, ranks, tallies and decides in one pass", () => {
    const result = aggregate([
      f({ dimension: "security", file: "src/a.ts", line: 8, severity: "critical", title: "service_role 노출" }),
      f({ dimension: "architecture", file: "src/a.ts", line: 8, severity: "critical", title: "service_role 노출" }),
      f({ dimension: "correctness", file: "src/a.ts", line: 22, severity: "major", title: "세금 계산 부동소수점" }),
      f({ dimension: "security", file: "src/a.ts", line: 23, severity: "minor", title: "세금 계산 컴포넌트에서 수행" }),
    ]);
    // line 8 (2 dims → 1) + line 22/23 세금 (인접+유사 → 1, max=major) = 2 findings
    expect(result.findings).toHaveLength(2);
    expect(result.verdict).toBe("Blocked");
    expect(result.tally).toEqual({ critical: 1, major: 1, minor: 0, nit: 0 });
    expect(result.findings[0].dimensions).toEqual(["architecture", "security"]);
  });
});

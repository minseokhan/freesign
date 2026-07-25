import { describe, expect, it } from "vitest";

import { summarizeInsights } from "../insights";

describe("summarizeInsights", () => {
  it("위험도 분포와 공통 조항 findings top N을 집계한다", () => {
    const result = summarizeInsights(
      [
        { risk_level: "high", findings: [{ clause_title: "지급", severity: "high", note: "a" }] },
        { risk_level: "high", findings: [{ clause_title: "지급", severity: "medium", note: "b" }] },
        { risk_level: "low", findings: [{ clause_title: "해지", severity: "low", note: "c" }] },
      ],
      2,
    );

    expect(result.total).toBe(3);
    expect(result.riskCounts).toEqual({ low: 1, medium: 0, high: 2 });
    expect(result.topFindings[0]).toEqual({ clauseTitle: "지급", count: 2 });
    expect(result.topFindings.length).toBeLessThanOrEqual(2);
  });

  it("빈 입력은 0 분포를 반환한다", () => {
    const result = summarizeInsights([], 3);
    expect(result.total).toBe(0);
    expect(result.riskCounts).toEqual({ low: 0, medium: 0, high: 0 });
    expect(result.topFindings).toEqual([]);
  });

  it("잘못된 findings 모양은 무시한다", () => {
    const result = summarizeInsights(
      [{ risk_level: "medium", findings: "not-an-array" as unknown as [] }],
      5,
    );
    expect(result.riskCounts.medium).toBe(1);
    expect(result.topFindings).toEqual([]);
  });
});

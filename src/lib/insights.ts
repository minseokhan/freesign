// 계약 인사이트 집계(순수 함수). 리포트의 "종합 계약 피드백 요약"에 쓰인다.
export type RiskLevel = "low" | "medium" | "high";

export interface InsightRow {
  risk_level: RiskLevel;
  findings: unknown;
}

export interface InsightSummary {
  total: number;
  riskCounts: Record<RiskLevel, number>;
  topFindings: { clauseTitle: string; count: number }[];
}

export function summarizeInsights(rows: InsightRow[], topN: number): InsightSummary {
  const riskCounts: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0 };
  const clauseCounts = new Map<string, number>();

  for (const row of rows) {
    if (row.risk_level in riskCounts) {
      riskCounts[row.risk_level] += 1;
    }

    if (!Array.isArray(row.findings)) continue;
    for (const finding of row.findings) {
      if (!finding || typeof finding !== "object") continue;
      const title = (finding as Record<string, unknown>).clause_title;
      if (typeof title !== "string" || !title.trim()) continue;
      clauseCounts.set(title, (clauseCounts.get(title) ?? 0) + 1);
    }
  }

  const topFindings = [...clauseCounts.entries()]
    .map(([clauseTitle, count]) => ({ clauseTitle, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(0, topN));

  return { total: rows.length, riskCounts, topFindings };
}

"use client";

import { useState } from "react";

import { UpgradeButton } from "@/components/billing/upgrade-cta";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type RiskLevel = "low" | "medium" | "high";

export type ContractInsightView = {
  summary: string;
  risk_level: RiskLevel;
  findings: { clause_title: string; severity: RiskLevel; note: string }[];
  source: string;
  createdAt?: string;
};

const riskMeta: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: "낮음", className: "bg-green-100 text-green-800" },
  medium: { label: "보통", className: "bg-status-waiting-bg text-amber-800" },
  high: { label: "높음", className: "bg-status-overdue-bg text-red-700" },
};

export function ContractInsightPanel({
  contractId,
  initialInsight,
}: {
  contractId: string;
  initialInsight: ContractInsightView | null;
}) {
  const [insight, setInsight] = useState<ContractInsightView | null>(initialInsight);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upsell, setUpsell] = useState(false);

  async function analyze() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setUpsell(false);

    try {
      const res = await fetch(`/api/contracts/${contractId}/insights`, {
        method: "POST",
      });

      if (res.status === 402) {
        setUpsell(true);
        return;
      }

      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "분석에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }

      setInsight({ ...body.insight, createdAt: undefined });
    } catch {
      setError("분석에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <div className="border-b border-surface-border pb-lg">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <h3 className="text-lg font-semibold text-text-primary">AI 계약 인사이트</h3>
          <Button type="button" variant="secondary" disabled={loading} onClick={analyze}>
            {loading ? "분석 중" : insight ? "다시 분석" : "AI 인사이트 분석"}
          </Button>
        </div>
        <p className="mt-xs text-sm leading-relaxed text-text-muted">
          조항의 약점·누락을 검토 보조로 짚어 줍니다. 법적 자문이 아니며 참고용입니다.
        </p>
      </div>

      {upsell ? (
        <div className="mt-lg flex flex-col items-start gap-md rounded-md border border-dashed border-surface-border bg-surface-muted p-lg">
          <p className="text-sm text-text-body">
            AI 계약 인사이트는 Pro 전용이에요. 업그레이드하면 과거 계약의 약점을 분석하고 새 계약 초안에도 반영해 드려요.
          </p>
          <UpgradeButton />
        </div>
      ) : null}

      {error ? (
        <p className="mt-lg text-sm text-red-600" role="alert">{error}</p>
      ) : null}

      {insight ? (
        <div className="mt-lg space-y-lg">
          <div className="flex flex-wrap items-center gap-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
              위험도
            </span>
            <span className={`rounded-full px-sm py-0.5 text-xs font-medium ${riskMeta[insight.risk_level].className}`}>
              {riskMeta[insight.risk_level].label}
            </span>
            {insight.source === "fallback" ? (
              <span className="text-xs text-text-muted">(AI 분석 실패 — 기본 안내)</span>
            ) : null}
          </div>

          <p className="text-sm leading-relaxed text-text-body">{insight.summary}</p>

          {insight.findings.length > 0 ? (
            <ul className="space-y-sm">
              {insight.findings.map((finding, index) => (
                <li key={index} className="rounded-md border border-surface-border p-md">
                  <div className="flex flex-wrap items-center gap-sm">
                    <span className={`rounded-full px-sm py-0.5 text-xs font-medium ${riskMeta[finding.severity].className}`}>
                      {riskMeta[finding.severity].label}
                    </span>
                    <span className="text-sm font-medium text-text-primary">{finding.clause_title}</span>
                  </div>
                  <p className="mt-xs text-sm leading-relaxed text-text-body">{finding.note}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : !upsell && !error ? (
        <p className="mt-lg text-sm text-text-muted">
          아직 분석하지 않았어요. 위 버튼으로 이 계약의 인사이트를 생성해 보세요.
        </p>
      ) : null}
    </Card>
  );
}

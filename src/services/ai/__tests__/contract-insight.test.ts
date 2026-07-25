import { describe, expect, it, vi } from "vitest";

import {
  buildInsightFallback,
  generateContractInsight,
  normalizeFindings,
  type ContractInsightInput,
  type AnthropicMessagesClient,
} from "../contract-insight";

const input: ContractInsightInput = {
  title: "웹 유지보수 계약",
  plainSummary: "월 유지보수 용역.",
  clauses: [
    { title: "대금 및 지급", body: "월 100만원", plain_summary: "월 100만원 지급" },
  ],
};

describe("buildInsightFallback", () => {
  it("중립 폴백 인사이트를 만든다", () => {
    const insight = buildInsightFallback();
    expect(insight.source).toBe("fallback");
    expect(["low", "medium", "high"]).toContain(insight.risk_level);
    expect(Array.isArray(insight.findings)).toBe(true);
  });
});

describe("normalizeFindings", () => {
  it("severity를 허용값으로 정규화하고 잘못된 항목은 버린다", () => {
    const findings = normalizeFindings([
      { clause_title: "지급", severity: "high", note: "지연배상 조항 없음" },
      { clause_title: "", severity: "weird", note: "" },
      { nope: true },
    ]);
    expect(findings).toEqual([
      { clause_title: "지급", severity: "high", note: "지연배상 조항 없음" },
    ]);
  });
});

describe("generateContractInsight", () => {
  function clientReturning(payload: unknown): AnthropicMessagesClient {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "tool_use", name: "return_contract_insight", input: payload }],
        }),
      },
    };
  }

  it("tool_use 응답을 파싱해 AI 인사이트를 반환한다", async () => {
    const client = clientReturning({
      summary_ko: "전반적으로 무난하나 지연배상 조항이 없습니다.",
      risk_level: "medium",
      findings: [{ clause_title: "대금 및 지급", severity: "medium", note: "지연배상 규정 부재" }],
    });

    const insight = await generateContractInsight(input, { client, retryCount: 0 });
    expect(insight.source).toBe("ai");
    expect(insight.risk_level).toBe("medium");
    expect(insight.findings).toHaveLength(1);
  });

  it("스키마 불일치 응답이면 폴백", async () => {
    const client = clientReturning({ risk_level: "nope" });
    const insight = await generateContractInsight(input, { client, retryCount: 0 });
    expect(insight.source).toBe("fallback");
  });

  it("API 예외 시 폴백", async () => {
    const client: AnthropicMessagesClient = {
      messages: { create: vi.fn().mockRejectedValue(new Error("down")) },
    };
    const insight = await generateContractInsight(input, { client, retryCount: 0 });
    expect(insight.source).toBe("fallback");
  });
});

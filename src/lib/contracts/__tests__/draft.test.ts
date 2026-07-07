import { describe, expect, it } from "vitest";

import { toContractClauses } from "@/lib/contracts/draft";
import { REQUIRED_CONTRACT_CLAUSES } from "@/services/ai/contract-draft";

describe("toContractClauses", () => {
  it("keeps the code-owned required clause order and annotates draft source", () => {
    const clauses = toContractClauses({
      title: "계약서 초안",
      body: REQUIRED_CONTRACT_CLAUSES.map(
        (title, index) => `${index + 1}. ${title}\n${title} 본문입니다.`,
      ).join("\n\n"),
      plain_summary: "전체 요약입니다.",
      needs_review: false,
      source: "ai",
    });

    expect(clauses).toHaveLength(REQUIRED_CONTRACT_CLAUSES.length);
    expect(clauses.map((clause) => clause.title)).toEqual([
      ...REQUIRED_CONTRACT_CLAUSES,
    ]);
    expect(clauses[0]).toEqual({
      title: "당사자",
      body: "당사자 본문입니다.",
      plain_summary: "전체 요약입니다.",
      needs_review: false,
      source: "ai",
    });
  });

  it("marks all clauses as needing review when the draft does", () => {
    const clauses = toContractClauses({
      title: "계약서 초안",
      body: "1. 당사자\n[검토 필요] 골격 조항입니다.",
      plain_summary: "검토 필요 요약입니다.",
      needs_review: true,
      source: "skeleton",
    });

    expect(clauses.every((clause) => clause.needs_review)).toBe(true);
    expect(clauses.every((clause) => clause.source === "skeleton")).toBe(true);
  });
});

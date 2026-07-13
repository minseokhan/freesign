import { describe, expect, it } from "vitest";

import { normalizeImportedClauses, toContractClauses } from "@/lib/contracts/draft";
import { contractClausesSchema } from "@/lib/validation/contract";
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
      // 계약 전체 요약은 계약 레벨에서 1회만 노출하므로 조항마다 복제하지 않는다.
      plain_summary: "",
      needs_review: false,
      source: "ai",
    });
    expect(clauses.every((clause) => clause.plain_summary === "")).toBe(true);
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

describe("normalizeImportedClauses", () => {
  it("keeps all canonical imported clauses and passes contract clause validation", () => {
    const raw = REQUIRED_CONTRACT_CLAUSES.map((title) => ({
      title,
      body: `${title} 본문입니다.`,
      plain_summary: `${title} 요약입니다.`,
      needs_review: false,
    }));

    const clauses = normalizeImportedClauses(raw);

    expect(clauses).toEqual(raw);
    expect(() => contractClausesSchema.parse(clauses)).not.toThrow();
  });

  it("fills missing canonical clauses with needs-review placeholders", () => {
    const clauses = normalizeImportedClauses([
      {
        title: "당사자",
        body: "양 당사자 정보입니다.",
        plain_summary: "누가 계약하는지 확인합니다.",
        needs_review: false,
      },
      {
        title: "용역 범위",
        body: "",
        plain_summary: " ",
        needs_review: false,
      },
    ]);

    expect(clauses).toHaveLength(REQUIRED_CONTRACT_CLAUSES.length);
    expect(clauses.map((clause) => clause.title)).toEqual([
      ...REQUIRED_CONTRACT_CLAUSES,
    ]);
    expect(clauses[1]).toEqual({
      title: "용역 범위",
      body: "[검토 필요]",
      plain_summary: "[검토 필요]",
      needs_review: true,
    });
    expect(clauses[2]).toEqual({
      title: "계약 기간",
      body: "[검토 필요]",
      plain_summary: "[검토 필요]",
      needs_review: true,
    });
    expect(() => contractClausesSchema.parse(clauses)).not.toThrow();
  });

  it("ignores non-canonical imported clause titles", () => {
    const clauses = normalizeImportedClauses([
      {
        title: "잡담",
        body: "표준 조항이 아닙니다.",
        plain_summary: "무시되어야 합니다.",
        needs_review: false,
      },
      {
        title: "분쟁 해결",
        body: "분쟁은 협의로 해결합니다.",
        plain_summary: "문제가 생기면 먼저 협의합니다.",
        needs_review: false,
      },
    ]);

    expect(clauses).toHaveLength(REQUIRED_CONTRACT_CLAUSES.length);
    expect(clauses.some((clause) => clause.title === "잡담")).toBe(false);
    expect(clauses.at(-1)).toEqual({
      title: "분쟁 해결",
      body: "분쟁은 협의로 해결합니다.",
      plain_summary: "문제가 생기면 먼저 협의합니다.",
      needs_review: false,
    });
    expect(() => contractClausesSchema.parse(clauses)).not.toThrow();
  });
});

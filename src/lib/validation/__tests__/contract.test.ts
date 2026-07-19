import { describe, expect, it } from "vitest";

import {
  contractClausesSchema,
  contractDraftInputSchema,
} from "@/lib/validation/contract";
import { REQUIRED_CONTRACT_CLAUSES } from "@/services/ai/contract-draft";

const validContractInput = {
  title: "블루스튜디오 브랜드 랜딩 계약",
  client_id: "11111111-1111-4111-8111-111111111111",
  scope: "브랜드 랜딩 페이지 디자인과 반응형 퍼블리싱",
  amount: 3_000_000,
  start_date: "2026-08-01",
  end_date: "2026-08-31",
  due_date: "2026-09-10",
};

describe("contractDraftInputSchema", () => {
  it("accepts valid structured contract input", () => {
    expect(contractDraftInputSchema.parse(validContractInput)).toEqual(
      validContractInput,
    );
  });

  it.each([0, -1])("rejects a non-positive amount: %s", (amount) => {
    expect(() =>
      contractDraftInputSchema.parse({ ...validContractInput, amount }),
    ).toThrow();
  });

  it("rejects an end date before the start date", () => {
    expect(() =>
      contractDraftInputSchema.parse({
        ...validContractInput,
        start_date: "2026-09-01",
        end_date: "2026-08-31",
      }),
    ).toThrow();
  });

  it("strips server-owned fields from client input", () => {
    const parsed = contractDraftInputSchema.parse({
      ...validContractInput,
      user_id: "attacker-user",
      status: "signed",
      clauses: [{ title: "위조 조항" }],
      doc_hash: "spoofed",
      signature_meta: { ip: "127.0.0.1" },
      contract_pdf_url: "contracts/spoof.pdf",
      is_demo: true,
    });

    expect(parsed).toEqual(validContractInput);
    expect(parsed).not.toHaveProperty("user_id");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("clauses");
    expect(parsed).not.toHaveProperty("doc_hash");
    expect(parsed).not.toHaveProperty("signature_meta");
    expect(parsed).not.toHaveProperty("contract_pdf_url");
    expect(parsed).not.toHaveProperty("is_demo");
  });
});

const validClauses = REQUIRED_CONTRACT_CLAUSES.map((title) => ({
  title,
  body: `${title} 조항 본문입니다.`,
  plain_summary: `${title} 조항 요약입니다.`,
  needs_review: title === "대금 및 지급",
}));

describe("contractClausesSchema", () => {
  it("accepts valid contract clauses with every required clause", () => {
    expect(contractClausesSchema.parse(validClauses)).toEqual(validClauses);
  });

  it("rejects clauses missing a required title", () => {
    const missingRequiredClause = validClauses.filter(
      (clause) => clause.title !== "비밀유지",
    );

    expect(() => contractClausesSchema.parse(missingRequiredClause)).toThrow();
  });

  it("rejects a non-boolean needs_review flag", () => {
    expect(() =>
      contractClausesSchema.parse([
        ...validClauses.slice(0, -1),
        { ...validClauses.at(-1), needs_review: "true" },
      ]),
    ).toThrow();
  });

  it("rejects an empty clause body", () => {
    expect(() =>
      contractClausesSchema.parse([
        { ...validClauses[0], body: " " },
        ...validClauses.slice(1),
      ]),
    ).toThrow();
  });

  it("accepts an empty clause plain_summary (AI 초안은 조항별 요약을 비워 두고 계약 레벨 요약을 쓴다)", () => {
    const withEmptySummary = [
      { ...validClauses[0], plain_summary: "" },
      ...validClauses.slice(1),
    ];

    expect(contractClausesSchema.parse(withEmptySummary)).toEqual(
      withEmptySummary,
    );
  });
});

import { describe, expect, it } from "vitest";

import { contractDraftInputSchema } from "@/lib/validation/contract";

const validContractInput = {
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

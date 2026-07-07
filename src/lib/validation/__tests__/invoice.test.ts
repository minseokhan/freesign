import { describe, expect, it } from "vitest";

import { invoiceInputSchema } from "../invoice";

const validInput = {
  contract_id: "11111111-1111-4111-8111-111111111111",
  amount: 1_000_000,
  issue_date: "2026-08-01",
  due_date: "2026-08-31",
  withholding_type: "wt_3_3",
};

describe("invoiceInputSchema", () => {
  it("accepts only client-editable invoice issue fields", () => {
    const result = invoiceInputSchema.safeParse({
      ...validInput,
      client_id: "22222222-2222-4222-8222-222222222222",
      user_id: "attacker-user",
      payment_status: "paid",
      paid_at: "2026-08-02T00:00:00.000Z",
      withholding_amount: 1,
      net_amount: 1,
      payment_method: "spoofed",
      is_demo: true,
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data).toEqual(validInput);
      expect(result.data).not.toHaveProperty("client_id");
      expect(result.data).not.toHaveProperty("user_id");
      expect(result.data).not.toHaveProperty("payment_status");
      expect(result.data).not.toHaveProperty("withholding_amount");
      expect(result.data).not.toHaveProperty("net_amount");
    }
  });

  it("rejects invalid amount and due date order", () => {
    const result = invoiceInputSchema.safeParse({
      ...validInput,
      amount: 0,
      due_date: "2026-07-31",
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.amount).toBeDefined();
    expect(result.error?.flatten().fieldErrors.due_date).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";

import { calcWithholding, type WithholdingType } from "@/lib/tax";

describe("calcWithholding", () => {
  it("does not withhold tax for none", () => {
    expect(calcWithholding(1_000_000, "none")).toEqual({
      incomeTax: 0,
      localTax: 0,
      withholding: 0,
      net: 1_000_000
    });
  });

  it("calculates the standard 3.3% breakdown", () => {
    expect(calcWithholding(1_000_000, "wt_3_3")).toEqual({
      incomeTax: 30_000,
      localTax: 3_000,
      withholding: 33_000,
      net: 967_000
    });
  });

  it("calculates the standard 8.8% breakdown", () => {
    expect(calcWithholding(1_000_000, "wt_8_8")).toEqual({
      incomeTax: 80_000,
      localTax: 8_000,
      withholding: 88_000,
      net: 912_000
    });
  });

  it("floors fractional income tax before calculating local tax", () => {
    expect(calcWithholding(1_001, "wt_3_3")).toEqual({
      incomeTax: 30,
      localTax: 0,
      withholding: 30,
      net: 971
    });
  });

  it("floors local tax to the nearest 10 won", () => {
    expect(calcWithholding(33_667, "wt_3_3")).toEqual({
      incomeTax: 1_010,
      localTax: 100,
      withholding: 1_110,
      net: 32_557
    });
  });

  it("keeps valid outputs compatible with invoice CHECK constraints", () => {
    const types: WithholdingType[] = ["wt_3_3", "wt_8_8", "none"];
    const amounts = [1, 99, 1_001, 33_667, 1_000_000, Number.MAX_SAFE_INTEGER];

    for (const type of types) {
      for (const amount of amounts) {
        const result = calcWithholding(amount, type);

        expect(result.withholding).toBeGreaterThanOrEqual(0);
        expect(result.withholding).toBeLessThanOrEqual(amount);
        expect(result.net).toBeGreaterThanOrEqual(0);
        expect(result.net).toBe(amount - result.withholding);
      }
    }
  });

  it("rejects zero and negative amounts because invoices require amount > 0", () => {
    expect(() => calcWithholding(0, "wt_3_3")).toThrow("amount must be a positive integer");
    expect(() => calcWithholding(-1, "wt_3_3")).toThrow("amount must be a positive integer");
  });
});

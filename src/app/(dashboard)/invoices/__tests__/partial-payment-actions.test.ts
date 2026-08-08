import { describe, expect, it } from "vitest";

import { formatPartialAmount } from "../partial-payment-actions";

describe("formatPartialAmount", () => {
  it("천 단위 구분과 원 단위를 붙인다", () => {
    expect(formatPartialAmount(1234567)).toBe("1,234,567원");
  });

  it("소수점은 반올림한다", () => {
    expect(formatPartialAmount(1000.6)).toBe("1,001원");
  });
});

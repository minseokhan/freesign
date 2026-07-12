import { describe, expect, it } from "vitest";

import { profileInputSchema } from "@/lib/validation/profile";

const validProfileInput = {
  display_name: "홍길동",
  default_withholding_type: "wt_3_3",
  bank_name: "국민은행",
  bank_account_number: "123-456-789012",
  bank_account_holder: "홍길동",
};

describe("profileInputSchema", () => {
  it("accepts valid profile domain fields", () => {
    expect(profileInputSchema.parse(validProfileInput)).toEqual(validProfileInput);
  });

  it("trims text fields and normalizes empty strings to null", () => {
    const parsed = profileInputSchema.parse({
      ...validProfileInput,
      display_name: "  홍길동  ",
      bank_name: "",
      bank_account_number: "   ",
      bank_account_holder: "",
    });

    expect(parsed.display_name).toBe("홍길동");
    expect(parsed.bank_name).toBeNull();
    expect(parsed.bank_account_number).toBeNull();
    expect(parsed.bank_account_holder).toBeNull();
  });

  it("accepts a profile with no bank account or display name registered", () => {
    const parsed = profileInputSchema.parse({
      default_withholding_type: "none",
    });

    expect(parsed.default_withholding_type).toBe("none");
    expect(parsed.display_name).toBeUndefined();
    expect(parsed.bank_name).toBeUndefined();
  });

  it("rejects a withholding type outside the enum", () => {
    expect(() =>
      profileInputSchema.parse({
        ...validProfileInput,
        default_withholding_type: "wt_9_9",
      }),
    ).toThrow();
  });

  it("strips server-owned fields from untrusted client input", () => {
    const parsed = profileInputSchema.parse({
      ...validProfileInput,
      user_id: "attacker-user",
      is_demo: true,
      created_at: "2026-07-07T00:00:00.000Z",
      updated_at: "2026-07-07T00:00:00.000Z",
    });

    expect(parsed).toEqual(validProfileInput);
    expect(parsed).not.toHaveProperty("user_id");
    expect(parsed).not.toHaveProperty("is_demo");
  });
});

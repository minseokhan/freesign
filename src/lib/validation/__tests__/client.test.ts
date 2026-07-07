import { describe, expect, it } from "vitest";

import { clientInputSchema } from "@/lib/validation/client";

const validClientInput = {
  name: "Acme Studio",
  channel: "linkedin",
  contact_email: "hello@acme.test",
  contact_phone: "010-1234-5678",
  memo: "Retainer client",
};

describe("clientInputSchema", () => {
  it("accepts valid client domain fields", () => {
    expect(clientInputSchema.parse(validClientInput)).toEqual(validClientInput);
  });

  it("trims the required name and rejects an empty name", () => {
    expect(clientInputSchema.parse({ ...validClientInput, name: "  Acme  " }).name).toBe(
      "Acme",
    );

    expect(() =>
      clientInputSchema.parse({ ...validClientInput, name: "   " }),
    ).toThrow();
  });

  it("rejects channels outside the database check constraint values", () => {
    expect(() =>
      clientInputSchema.parse({ ...validClientInput, channel: "blog" }),
    ).toThrow();
  });

  it("strips server-owned fields from untrusted client input", () => {
    const parsed = clientInputSchema.parse({
      ...validClientInput,
      id: "client-supplied-id",
      user_id: "attacker-user",
      is_demo: true,
      deleted_at: "2026-07-07T00:00:00.000Z",
      created_at: "2026-07-07T00:00:00.000Z",
      updated_at: "2026-07-07T00:00:00.000Z",
    });

    expect(parsed).toEqual(validClientInput);
    expect(parsed).not.toHaveProperty("user_id");
    expect(parsed).not.toHaveProperty("is_demo");
    expect(parsed).not.toHaveProperty("deleted_at");
  });

  it("validates email format when contact_email is provided", () => {
    expect(() =>
      clientInputSchema.parse({ ...validClientInput, contact_email: "not-email" }),
    ).toThrow();

    expect(
      clientInputSchema.parse({ ...validClientInput, contact_email: "" }).contact_email,
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { generateSigningToken, hashSigningToken } from "@/lib/signing-token";

describe("signing tokens", () => {
  it("generates a 32-byte random base64url token", () => {
    const first = generateSigningToken();
    const second = generateSigningToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("hashes tokens deterministically as sha256 hex", () => {
    const token = "token-value";

    expect(hashSigningToken(token)).toBe(hashSigningToken(token));
    expect(hashSigningToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSigningToken(token)).not.toBe(hashSigningToken("other-token"));
  });
});

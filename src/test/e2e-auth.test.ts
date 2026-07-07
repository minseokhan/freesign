import { describe, expect, it } from "vitest";

import { getTestLoginUrl, isTestLoginRedirect } from "./e2e-auth";

describe("e2e test login helper", () => {
  it("builds the dev test login URL from the configured base URL", () => {
    expect(getTestLoginUrl("http://localhost:3000").toString()).toBe(
      "http://localhost:3000/dev/test-login",
    );
  });

  it("accepts redirect responses as successful login responses", () => {
    expect(isTestLoginRedirect(302)).toBe(true);
    expect(isTestLoginRedirect(307)).toBe(true);
    expect(isTestLoginRedirect(308)).toBe(true);
    expect(isTestLoginRedirect(401)).toBe(false);
  });
});

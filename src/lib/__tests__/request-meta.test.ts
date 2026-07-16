// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  getRequestIp,
  getRequestIpHash,
  getRequestUserAgent,
} from "@/lib/request-meta";

function createRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/test", { headers });
}

describe("getRequestIp", () => {
  it("uses the first x-forwarded-for entry", () => {
    expect(
      getRequestIp(
        createRequest({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" }),
      ),
    ).toBe("203.0.113.10");
  });

  it("falls back to x-real-ip", () => {
    expect(getRequestIp(createRequest({ "x-real-ip": "198.51.100.7" }))).toBe(
      "198.51.100.7",
    );
  });

  it("returns unknown when no header is present", () => {
    expect(getRequestIp(createRequest())).toBe("unknown");
  });
});

describe("getRequestUserAgent", () => {
  it("returns the user-agent header", () => {
    expect(
      getRequestUserAgent(createRequest({ "user-agent": "Vitest Browser" })),
    ).toBe("Vitest Browser");
  });

  it("returns unknown when missing", () => {
    expect(getRequestUserAgent(createRequest())).toBe("unknown");
  });
});

describe("getRequestIpHash", () => {
  it("returns a deterministic 64-character hex hash of the ip", () => {
    const first = getRequestIpHash(
      createRequest({ "x-forwarded-for": "203.0.113.10" }),
    );
    const second = getRequestIpHash(
      createRequest({ "x-forwarded-for": "203.0.113.10" }),
    );

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
    expect(
      getRequestIpHash(createRequest({ "x-forwarded-for": "203.0.113.11" })),
    ).not.toBe(first);
  });
});

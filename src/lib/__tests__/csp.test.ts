import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, generateCspNonce } from "@/lib/csp";

function directive(policy: string, name: string): string | undefined {
  return policy
    .split("; ")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

describe("buildContentSecurityPolicy", () => {
  it("요청별 nonce를 script-src에 넣는다", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc123", isDev: false });

    expect(directive(policy, "script-src")).toBe(
      "script-src 'self' 'nonce-abc123'",
    );
  });

  it("프로덕션에서는 unsafe-eval을 허용하지 않는다", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc123", isDev: false });

    expect(policy).not.toContain("unsafe-eval");
  });

  it("dev에서는 webpack eval 소스맵 때문에 unsafe-eval을 허용한다", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc123", isDev: true });

    expect(directive(policy, "script-src")).toBe(
      "script-src 'self' 'nonce-abc123' 'unsafe-eval'",
    );
  });

  it("script-src를 추가해도 기존 하드닝 지시자를 그대로 유지한다", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc123", isDev: false });

    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
    expect(directive(policy, "style-src")).toBe(
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    );
    expect(directive(policy, "font-src")).toBe(
      "font-src 'self' data: https://cdn.jsdelivr.net",
    );
  });

  it("스크립트 인라인을 통째로 열어두지 않는다", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc123", isDev: true });

    expect(directive(policy, "script-src")).not.toContain("'unsafe-inline'");
  });
});

describe("generateCspNonce", () => {
  it("호출마다 다른 값을 만든다", () => {
    expect(generateCspNonce()).not.toBe(generateCspNonce());
  });

  it("CSP 토큰에 쓸 수 있는 base64 문자만 담는다", () => {
    expect(generateCspNonce()).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});

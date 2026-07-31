import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Supabase middleware", () => {
  const source = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");

  it("refreshes Supabase auth tokens without route authorization redirects", () => {
    expect(source).toContain("supabase.auth.getUser()");
    expect(source).not.toContain("redirect(");
  });

  it("excludes static assets from the matcher", () => {
    expect(source).toContain("_next/static");
    expect(source).toContain("_next/image");
    expect(source).toContain("favicon.ico");
  });

  // Next는 "요청" 헤더의 CSP를 보고 인라인 스크립트에 nonce를 붙인다.
  // 응답에만 달면 정책은 걸리는데 nonce가 안 붙어 앱이 통째로 죽는다.
  it("puts the per-request CSP on both the request and the response", () => {
    expect(source).toContain('headers.set("content-security-policy", csp)');
    expect(source).toContain(
      'response.headers.set("content-security-policy", csp)',
    );
  });

  it("keeps the nonce unique per request", () => {
    expect(source).toContain("generateCspNonce()");
  });
});

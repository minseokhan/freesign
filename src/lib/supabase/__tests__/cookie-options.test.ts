import { afterEach, describe, expect, it, vi } from "vitest";

// #28: sb-* 세션 쿠키가 @supabase/ssr 기본값(httpOnly:false, secure 없음)으로 나가면
// XSS 한 번에 400일짜리 refresh 토큰까지 통째로 털린다.
describe("SUPABASE_COOKIE_OPTIONS", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadOptions() {
    const loaded = await import("../cookie-options");
    return loaded.SUPABASE_COOKIE_OPTIONS;
  }

  it("keeps session cookies out of document.cookie and scopes them to the site", async () => {
    vi.resetModules();
    const options = await loadOptions();

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("marks cookies Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();

    expect((await loadOptions()).secure).toBe(true);
  });

  it("allows plain http in development so local dev keeps working", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();

    expect((await loadOptions()).secure).toBe(false);
  });
});

import { createServerClient } from "@supabase/ssr";

import { createAnonClient } from "@/lib/supabase/anon";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ rpc: vi.fn() })),
}));

describe("Supabase anon client", () => {
  beforeEach(() => {
    vi.mocked(createServerClient).mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a cookie-less client with the anon key (no session, no service_role)", () => {
    createAnonClient();

    expect(createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.objectContaining({ cookies: expect.any(Object) }),
    );

    const options = vi.mocked(createServerClient).mock.calls[0][2] as {
      cookies: { getAll: () => unknown[]; setAll: (values: unknown[]) => void };
    };

    // 세션 쿠키를 읽지도 쓰지도 않는다 — 비로그인 서명이 핵심 요구사항.
    expect(options.cookies.getAll()).toEqual([]);
    expect(() => options.cookies.setAll([])).not.toThrow();
  });
});

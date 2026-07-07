import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

const cookieStore = {
  getAll: vi.fn(() => [{ name: "sb-token", value: "token" }]),
  set: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: {} })),
}));

describe("Supabase server client", () => {
  beforeEach(() => {
    vi.mocked(createServerClient).mockClear();
    vi.mocked(cookies).mockClear();
    cookieStore.getAll.mockClear();
    cookieStore.set.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a cookie-backed server client with public Supabase env", async () => {
    await createClient();

    expect(createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.objectContaining({
        cookies: expect.objectContaining({
          getAll: expect.any(Function),
          setAll: expect.any(Function),
        }),
      }),
    );
  });

  it("wires cookie reads and writes through Next cookies", async () => {
    await createClient();

    const options = vi.mocked(createServerClient).mock.calls[0]?.[2];
    const cookieMethods = options?.cookies;

    expect(cookieMethods?.getAll()).toEqual([
      { name: "sb-token", value: "token" },
    ]);

    cookieMethods?.setAll([
      { name: "sb-token", value: "new-token", options: { path: "/" } },
    ]);

    expect(cookieStore.set).toHaveBeenCalledWith("sb-token", "new-token", {
      path: "/",
    });
  });
});

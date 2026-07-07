const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

describe("requireUser", () => {
  beforeEach(() => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getSession: mocks.getSession,
        getUser: mocks.getUser,
      },
    });
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "me@example.com",
        },
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns the authenticated user without redirecting", async () => {
    const { requireUser } = await import("@/lib/auth");

    await expect(requireUser()).resolves.toMatchObject({
      id: "user-1",
      email: "me@example.com",
    });

    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects to login when there is no authenticated user", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    const { requireUser } = await import("@/lib/auth");

    await requireUser();

    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("uses getUser instead of getSession for authorization", async () => {
    const { requireUser } = await import("@/lib/auth");

    await requireUser();

    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  redirect: vi.fn(),
  capture: vi.fn(),
  flush: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: () => ({
    capture: mocks.capture,
    flush: mocks.flush,
  }),
}));

import { signOut } from "../actions";

describe("signOut action", () => {
  beforeEach(() => {
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mocks.flush.mockResolvedValue(undefined);
    mocks.createClient.mockResolvedValue({
      auth: { signOut: mocks.signOut, getUser: mocks.getUser },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("signs the user out and redirects to the landing page", async () => {
    await signOut();

    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/");
    expect(mocks.capture).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "user_signed_out",
    });
  });

  it("throws and does not redirect when sign-out fails", async () => {
    mocks.signOut.mockResolvedValue({ error: { message: "network error" } });

    await expect(signOut()).rejects.toThrow("로그아웃에 실패했습니다");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

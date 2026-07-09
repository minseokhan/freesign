const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import { signOut } from "../actions";

describe("signOut action", () => {
  beforeEach(() => {
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: { signOut: mocks.signOut },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("signs the user out and redirects to the landing page", async () => {
    await signOut();

    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("throws and does not redirect when sign-out fails", async () => {
    mocks.signOut.mockResolvedValue({ error: { message: "network error" } });

    await expect(signOut()).rejects.toThrow("로그아웃에 실패했습니다");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

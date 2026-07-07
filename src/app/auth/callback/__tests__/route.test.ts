import { GET } from "../route";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

describe("OAuth callback route", () => {
  beforeEach(() => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exchanges a code and redirects to dashboard by default", async () => {
    const response = await GET(
      new Request("http://localhost:3000/auth/callback?code=oauth-code"),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("oauth-code");
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });

  it("redirects to a safe internal next path after successful exchange", async () => {
    const response = await GET(
      new Request(
        "http://localhost:3000/auth/callback?code=oauth-code&next=/contracts",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/contracts",
    );
  });

  it("redirects to login without throwing when code is missing", async () => {
    const response = await GET(
      new Request("http://localhost:3000/auth/callback"),
    );

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?error=auth",
    );
  });

  it("redirects to login without throwing when code exchange fails", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: new Error("invalid code"),
    });

    const response = await GET(
      new Request("http://localhost:3000/auth/callback?code=bad-code"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?error=auth",
    );
  });

  it("ignores external next URLs to prevent open redirects", async () => {
    const response = await GET(
      new Request(
        "http://localhost:3000/auth/callback?code=oauth-code&next=https://evil.example",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });

  it("ignores protocol-relative next URLs to prevent open redirects", async () => {
    const response = await GET(
      new Request(
        "http://localhost:3000/auth/callback?code=oauth-code&next=//evil.example/path",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });
});

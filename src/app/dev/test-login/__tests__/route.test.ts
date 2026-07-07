import { GET } from "../route";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

describe("dev test login route", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: mocks.signInWithPassword,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns 404 in production without attempting password sign-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_TEST_LOGIN", "true");
    vi.stubEnv("E2E_TEST_EMAIL", "dev@example.com");
    vi.stubEnv("E2E_TEST_PASSWORD", "password");

    const response = await GET(
      new Request("http://localhost:3000/dev/test-login"),
    );

    expect(response.status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("returns 404 when explicit opt-in is missing outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("E2E_TEST_EMAIL", "dev@example.com");
    vi.stubEnv("E2E_TEST_PASSWORD", "password");

    const response = await GET(
      new Request("http://localhost:3000/dev/test-login"),
    );

    expect(response.status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in with password and redirects to dashboard when both guards pass", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ALLOW_TEST_LOGIN", "true");
    vi.stubEnv("E2E_TEST_EMAIL", "dev@example.com");
    vi.stubEnv("E2E_TEST_PASSWORD", "password");

    const response = await GET(
      new Request("http://localhost:3000/dev/test-login"),
    );

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "dev@example.com",
      password: "password",
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });

  it("returns a clear 400 response when credentials are missing", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ALLOW_TEST_LOGIN", "true");

    const response = await GET(
      new Request("http://localhost:3000/dev/test-login"),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Missing E2E test credentials");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
});

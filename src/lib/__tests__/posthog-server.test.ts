import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const captureException = vi.fn();
const flush = vi.fn().mockResolvedValue(undefined);

vi.mock("posthog-node", () => {
  const PostHog = vi.fn().mockImplementation(() => ({
    captureException,
    flush,
  }));
  return { PostHog };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getPostHogClient", () => {
  it("PostHog 클라이언트를 반환한다", async () => {
    const { getPostHogClient } = await import("@/lib/posthog-server");
    const client = getPostHogClient();
    expect(client).toBeDefined();
  });

  it("동일한 인스턴스를 재사용한다(싱글톤)", async () => {
    const { getPostHogClient } = await import("@/lib/posthog-server");
    const a = getPostHogClient();
    const b = getPostHogClient();
    expect(a).toBe(b);
  });
});

describe("parsePostHogDistinctId", () => {
  const token = "phc_test";
  const cookieValue = encodeURIComponent(
    JSON.stringify({ distinct_id: "user-123", other: "x" }),
  );

  it("PostHog 쿠키에서 distinct_id를 읽는다", async () => {
    const { parsePostHogDistinctId } = await import("@/lib/posthog-server");

    const result = parsePostHogDistinctId(
      `foo=bar; ph_${token}_posthog=${cookieValue}; baz=1`,
      token,
    );

    expect(result).toBe("user-123");
  });

  it("쿠키가 없거나 형식이 깨지면 undefined를 반환한다", async () => {
    const { parsePostHogDistinctId } = await import("@/lib/posthog-server");

    expect(parsePostHogDistinctId(undefined, token)).toBeUndefined();
    expect(parsePostHogDistinctId("foo=bar", token)).toBeUndefined();
    expect(
      parsePostHogDistinctId(`ph_${token}_posthog=not-json`, token),
    ).toBeUndefined();
  });
});

describe("captureServerException", () => {
  it("토큰이 없으면 아무것도 하지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
    const { captureServerException } = await import("@/lib/posthog-server");

    await captureServerException(new Error("boom"));

    expect(captureException).not.toHaveBeenCalled();
  });

  it("Error를 distinctId·properties와 함께 캡처하고 flush한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
    const { captureServerException } = await import("@/lib/posthog-server");
    const error = new Error("boom");

    await captureServerException(error, "user-1", { route: "sign" });

    expect(captureException).toHaveBeenCalledWith(error, "user-1", {
      route: "sign",
    });
    expect(flush).toHaveBeenCalled();
  });

  it("Error가 아닌 값은 Error로 래핑한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
    const { captureServerException } = await import("@/lib/posthog-server");

    await captureServerException("db exploded");

    const captured = captureException.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe("db exploded");
  });

  it("캡처 자체가 실패해도 예외를 던지지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
    captureException.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    const { captureServerException } = await import("@/lib/posthog-server");

    await expect(captureServerException(new Error("boom"))).resolves.toBeUndefined();
  });
});

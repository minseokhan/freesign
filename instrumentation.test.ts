import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const captureServerException = vi.fn().mockResolvedValue(undefined);
const parsePostHogDistinctId = vi.fn().mockReturnValue("user-123");

vi.mock("@/lib/posthog-server", () => ({
  captureServerException,
  parsePostHogDistinctId,
}));

const request = {
  path: "/contracts",
  method: "GET",
  headers: { cookie: "ph_phc_test_posthog=encoded" },
};
const context = {
  routerKind: "App Router",
  routePath: "/contracts",
  routeType: "render",
  revalidateReason: undefined,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("onRequestError", () => {
  it("nodejs 런타임에서 예외를 distinct_id·요청 컨텍스트와 함께 캡처한다", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
    const { onRequestError } = await import("./instrumentation");
    const error = new Error("boom");

    await onRequestError(error, request, context);

    expect(parsePostHogDistinctId).toHaveBeenCalledWith(
      request.headers.cookie,
      "phc_test",
    );
    expect(captureServerException).toHaveBeenCalledWith(error, "user-123", {
      path: "/contracts",
      method: "GET",
      router_kind: "App Router",
      route_type: "render",
    });
  });

  it("edge 런타임에서는 아무것도 하지 않는다", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { onRequestError } = await import("./instrumentation");

    await onRequestError(new Error("boom"), request, context);

    expect(captureServerException).not.toHaveBeenCalled();
  });
});

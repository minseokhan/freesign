import { describe, it, expect, vi } from "vitest";

const mockInit = vi.fn();

vi.mock("posthog-js", () => ({
  default: { init: mockInit },
}));

describe("instrumentation-client", () => {
  it("posthog.init를 호출한다", async () => {
    await import("./instrumentation-client");
    expect(mockInit).toHaveBeenCalledOnce();
  });
});

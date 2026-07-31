import { describe, it, expect, vi } from "vitest";

const mockBoot = vi.fn();

vi.mock("@/lib/posthog-boot", () => ({
  bootPostHog: mockBoot,
}));

describe("instrumentation-client", () => {
  it("PostHog 부트스트랩을 건다", async () => {
    await import("./instrumentation-client");
    expect(mockBoot).toHaveBeenCalledOnce();
  });
});

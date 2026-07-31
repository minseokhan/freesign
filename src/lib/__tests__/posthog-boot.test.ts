import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInit = vi.fn();

vi.mock("posthog-js", () => ({
  default: { init: mockInit },
}));

describe("bootPostHog", () => {
  beforeEach(() => {
    vi.resetModules();
    mockInit.mockClear();
  });

  it("초기화를 유휴 시점으로 미룬다", async () => {
    vi.useFakeTimers();
    const { bootPostHog } = await import("../posthog-boot");

    bootPostHog();
    expect(mockInit).not.toHaveBeenCalled();

    // jsdom에는 requestIdleCallback이 없어 setTimeout 폴백을 탄다.
    vi.advanceTimersByTime(2000);
    expect(mockInit).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("여러 번 불러도 한 번만 초기화하고, 준비되면 resolve한다", async () => {
    vi.useFakeTimers();
    const { bootPostHog } = await import("../posthog-boot");

    const ready = bootPostHog();
    bootPostHog();
    vi.advanceTimersByTime(2000);
    await ready;

    expect(mockInit).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("서명 토큰 유출 방지용 sanitize_properties를 넘긴다", async () => {
    vi.useFakeTimers();
    const { bootPostHog } = await import("../posthog-boot");

    bootPostHog();
    vi.advanceTimersByTime(2000);

    expect(mockInit.mock.calls[0][1]).toMatchObject({
      api_host: "/ingest",
      disable_surveys: true,
    });
    expect(typeof mockInit.mock.calls[0][1].sanitize_properties).toBe("function");

    vi.useRealTimers();
  });
});

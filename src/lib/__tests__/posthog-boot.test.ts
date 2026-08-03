import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInit = vi.fn();
const mockCaptureException = vi.fn();

vi.mock("posthog-js", () => ({
  default: { init: mockInit, captureException: mockCaptureException },
}));

// jsdom은 dispatch한 error 이벤트를 미처리 예외로 다시 보고한다. 테스트 소음만 막는다.
window.addEventListener("error", (event) => event.preventDefault());

describe("bootPostHog", () => {
  beforeEach(() => {
    vi.resetModules();
    mockInit.mockClear();
    mockCaptureException.mockClear();
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

  it("서명 토큰 유출 방지용 before_send를 넘긴다", async () => {
    vi.useFakeTimers();
    const { bootPostHog } = await import("../posthog-boot");

    bootPostHog();
    vi.advanceTimersByTime(2000);

    expect(mockInit.mock.calls[0][1]).toMatchObject({
      api_host: "/ingest",
      disable_surveys: true,
    });
    expect(typeof mockInit.mock.calls[0][1].before_send).toBe("function");
    // deprecated 옵션은 콘솔에 경고를 찍는다.
    expect(mockInit.mock.calls[0][1]).not.toHaveProperty("sanitize_properties");

    vi.useRealTimers();
  });

  it("bootPostHogNow는 유휴를 기다리지 않고 초기화한다", async () => {
    vi.useFakeTimers();
    const { bootPostHogNow } = await import("../posthog-boot");

    await bootPostHogNow();
    expect(mockInit).toHaveBeenCalledOnce();

    // 뒤늦게 유휴 콜백이 돌아도 두 번 초기화하지 않는다.
    vi.advanceTimersByTime(2000);
    expect(mockInit).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("부트 전에 터진 예외는 즉시 초기화해 캡처한다", async () => {
    vi.useFakeTimers();
    const { bootPostHog } = await import("../posthog-boot");

    bootPostHog();
    const error = new Error("boom");
    window.dispatchEvent(
      new ErrorEvent("error", { error, message: "boom", cancelable: true }),
    );

    expect(mockInit).toHaveBeenCalledOnce();
    expect(mockCaptureException).toHaveBeenCalledWith(error);

    vi.useRealTimers();
  });

  it("부트 전에 삼켜진 promise 거부도 캡처한다", async () => {
    vi.useFakeTimers();
    const { bootPostHog } = await import("../posthog-boot");

    bootPostHog();
    const reason = new Error("rejected");
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason }),
    );

    expect(mockInit).toHaveBeenCalledOnce();
    expect(mockCaptureException).toHaveBeenCalledWith(reason);

    vi.useRealTimers();
  });

  it("초기화 후의 예외는 PostHog 자체 핸들러에 맡긴다", async () => {
    vi.useFakeTimers();
    const { bootPostHog } = await import("../posthog-boot");

    bootPostHog();
    vi.advanceTimersByTime(2000);
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("late"),
        message: "late",
        cancelable: true,
      }),
    );

    expect(mockCaptureException).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

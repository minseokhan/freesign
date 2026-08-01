import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GlobalError from "../global-error";

const mockCaptureException = vi.fn();
const mockBootNow = vi.fn(() => Promise.resolve());

vi.mock("posthog-js", () => ({
  default: { captureException: (...args: unknown[]) => mockCaptureException(...args) },
}));

vi.mock("@/lib/posthog-boot", () => ({
  bootPostHogNow: () => mockBootNow(),
}));

beforeEach(() => {
  mockCaptureException.mockClear();
  mockBootNow.mockClear();
});

describe("root global error boundary", () => {
  it("renders a reset action", () => {
    const reset = vi.fn();

    render(<GlobalError error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(
      screen.getByRole("heading", { name: "화면을 불러오지 못했어요" }),
    ).toBeInTheDocument();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("PostHog를 즉시 초기화한 뒤 에러를 캡처한다", async () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" });

    render(<GlobalError error={error} reset={vi.fn()} />);

    // 부트가 유휴 시점까지 미뤄져 있으면 초기 렌더 크래시가 유실된다.
    expect(mockBootNow).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(mockCaptureException).toHaveBeenCalledWith(error),
    );
  });
});

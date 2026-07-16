import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GlobalError from "../global-error";

const mockCaptureException = vi.fn();

vi.mock("posthog-js", () => ({
  default: { captureException: (...args: unknown[]) => mockCaptureException(...args) },
}));

beforeEach(() => {
  mockCaptureException.mockClear();
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

  it("에러를 PostHog로 캡처한다", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" });

    render(<GlobalError error={error} reset={vi.fn()} />);

    expect(mockCaptureException).toHaveBeenCalledWith(error);
  });
});

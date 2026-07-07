import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import GlobalError from "../global-error";

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
});

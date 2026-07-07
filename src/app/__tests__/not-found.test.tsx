import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound from "../not-found";

describe("root not-found page", () => {
  it("renders a recovery link to the dashboard", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { name: "페이지를 찾을 수 없어요" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "대시보드로 이동" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});

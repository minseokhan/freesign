import { render, screen } from "@testing-library/react";

import { Logo } from "@/components/logo";

describe("Logo", () => {
  it("exposes 매듭 as its accessible name", () => {
    render(<Logo />);

    expect(screen.getByRole("img", { name: "매듭" })).toBeInTheDocument();
  });
});

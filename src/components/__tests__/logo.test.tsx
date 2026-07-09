import { render, screen } from "@testing-library/react";

import { Logo } from "@/components/logo";

describe("Logo", () => {
  it("exposes FreeSign as its accessible name", () => {
    render(<Logo />);

    expect(screen.getByRole("img", { name: "FreeSign" })).toBeInTheDocument();
  });
});

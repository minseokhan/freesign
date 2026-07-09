import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/(auth)/actions", () => ({
  signOut: vi.fn(),
}));

import { UserMenu } from "@/components/user-menu";

describe("UserMenu", () => {
  it("renders the display name in the trigger", () => {
    render(
      <UserMenu name="김프리" email="free@example.com" avatarUrl={null} />,
    );

    expect(
      screen.getByRole("button", { name: /김프리/ }),
    ).toBeInTheDocument();
  });

  it("shows initials fallback when no avatar is provided", () => {
    render(<UserMenu name="김프리" email="free@example.com" avatarUrl={null} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("김")).toBeInTheDocument();
  });

  it("keeps the menu closed until the trigger is clicked", () => {
    render(<UserMenu name="김프리" email="free@example.com" avatarUrl={null} />);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /김프리/ }));

    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(screen.getByText("free@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "로그아웃" }),
    ).toBeInTheDocument();
  });
});

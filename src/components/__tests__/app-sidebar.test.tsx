import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";

import { AppSidebar } from "@/components/app-sidebar";

const usePathnameMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock()
}));

describe("AppSidebar", () => {
  it("renders dashboard navigation in IA order", () => {
    usePathnameMock.mockReturnValue("/dashboard");

    render(<AppSidebar />);

    const navigation = screen.getByRole("navigation", {
      name: "대시보드 내비게이션"
    });

    expect(
      within(navigation).getAllByRole("link").map((link) => link.textContent),
    ).toEqual(["대시보드", "클라이언트", "계약", "인보이스", "리포트", "설정"]);
  });

  it("marks the matching top-level route as active", () => {
    usePathnameMock.mockReturnValue("/contracts/new");

    render(<AppSidebar />);

    expect(screen.getByRole("link", { name: "계약" })).toHaveClass(
      "bg-blue-50",
      "text-blue-600",
    );
    expect(screen.getByRole("link", { name: "대시보드" })).not.toHaveClass(
      "bg-blue-50",
    );
  });
});

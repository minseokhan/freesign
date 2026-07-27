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
    ).toEqual([
      "대시보드",
      "클라이언트",
      "계약",
      "인보이스",
      "반복 인보이스Pro",
      "리포트",
      "설정",
    ]);
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

  // 회귀: /invoices/recurring은 "인보이스"(/invoices) 접두사와도 일치하므로,
  // 가장 긴 일치를 고르지 않으면 두 메뉴가 동시에 활성으로 보인다.
  it("activates only the longest matching nav item", () => {
    usePathnameMock.mockReturnValue("/invoices/recurring/new");

    render(<AppSidebar />);

    expect(
      screen.getByRole("link", { name: "반복 인보이스 Pro" }),
    ).toHaveClass("bg-blue-50", "text-blue-600");
    expect(screen.getByRole("link", { name: "인보이스" })).not.toHaveClass(
      "bg-blue-50",
    );
  });

  it("keeps the invoices item active on its own route", () => {
    usePathnameMock.mockReturnValue("/invoices");

    render(<AppSidebar />);

    expect(screen.getByRole("link", { name: "인보이스" })).toHaveClass(
      "bg-blue-50",
      "text-blue-600",
    );
    expect(
      screen.getByRole("link", { name: "반복 인보이스 Pro" }),
    ).not.toHaveClass("bg-blue-50");
  });

  // Pro 전용 기능임을 항상 알 수 있게, 플랜과 무관하게 뱃지를 노출한다.
  it("always marks the pro-only item with a badge", () => {
    usePathnameMock.mockReturnValue("/dashboard");

    render(<AppSidebar />);

    const link = screen.getByRole("link", { name: "반복 인보이스 Pro" });

    expect(link).toHaveAttribute("href", "/invoices/recurring");
    expect(within(link).getByText("Pro")).toBeInTheDocument();
  });
});

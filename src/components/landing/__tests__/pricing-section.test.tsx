import { render, screen } from "@testing-library/react";

import { PricingSection } from "@/components/landing/pricing-section";
import { FREE_FEATURES, PRO_FEATURES } from "@/lib/plan-features";

describe("PricingSection", () => {
  it("Free는 0원, Pro는 월 구독료를 표기한다", () => {
    render(<PricingSection ctaHref="/login" ctaLabel="무료로 시작하기" />);

    expect(screen.getByText("₩0")).toBeInTheDocument();
    expect(screen.getByText("₩14,900")).toBeInTheDocument();
  });

  it("두 플랜의 기능 목록을 모두 노출한다", () => {
    render(<PricingSection ctaHref="/login" ctaLabel="무료로 시작하기" />);

    for (const feature of [...FREE_FEATURES, ...PRO_FEATURES]) {
      expect(screen.getByText(feature)).toBeInTheDocument();
    }
  });

  it("두 플랜 모두 같은 시작 CTA로 연결한다", () => {
    render(<PricingSection ctaHref="/login" ctaLabel="무료로 시작하기" />);

    const links = screen.getAllByRole("link", { name: "무료로 시작하기" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/login");
    }
  });
});

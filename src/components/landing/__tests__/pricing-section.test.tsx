import { render, screen } from "@testing-library/react";

import { PricingSection } from "@/components/landing/pricing-section";
import { FREE_FEATURES, PRO_FEATURES } from "@/lib/plan-features";

describe("PricingSection", () => {
  it("Free는 0원, Pro는 월 구독료를 표기한다", () => {
    render(<PricingSection />);

    expect(screen.getByText("₩0")).toBeInTheDocument();
    expect(screen.getByText("₩14,900")).toBeInTheDocument();
  });

  it("두 플랜의 기능 목록을 모두 노출한다", () => {
    render(<PricingSection />);

    for (const feature of [...FREE_FEATURES, ...PRO_FEATURES]) {
      expect(screen.getByText(feature)).toBeInTheDocument();
    }
  });

  it("요금제 카드 안에는 CTA 링크를 두지 않는다", () => {
    render(<PricingSection />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

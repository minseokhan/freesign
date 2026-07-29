import { render, screen } from "@testing-library/react";

import { FAQ_ITEMS, FaqSection } from "@/components/landing/faq-section";

describe("FaqSection", () => {
  it("모든 문답을 화면에 노출한다", () => {
    render(<FaqSection />);

    for (const item of FAQ_ITEMS) {
      expect(screen.getByText(item.question)).toBeInTheDocument();
      expect(screen.getByText(item.answer)).toBeInTheDocument();
    }
  });

  it("법적 효력과 과금 문항을 포함한다", () => {
    const questions = FAQ_ITEMS.map((item) => item.question).join("\n");

    expect(questions).toContain("법적 효력");
    expect(questions).toContain("무료");
  });
});

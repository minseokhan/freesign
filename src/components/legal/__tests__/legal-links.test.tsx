import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LegalLinks } from "@/components/legal/legal-links";

describe("LegalLinks", () => {
  it("고지 문서 3종을 올바른 경로로 연결한다", () => {
    render(<LegalLinks />);

    const nav = screen.getByRole("navigation", { name: "고지 문서" });

    expect(
      within(nav).getByRole("link", { name: "개인정보처리방침" }),
    ).toHaveAttribute("href", "/legal/privacy");
    expect(
      within(nav).getByRole("link", { name: "이용약관" }),
    ).toHaveAttribute("href", "/legal/terms");
    expect(
      within(nav).getByRole("link", { name: "환불 및 청약철회 정책" }),
    ).toHaveAttribute("href", "/legal/refund");
  });
});

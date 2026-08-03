import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LEGAL } from "@/lib/legal";
import RefundPage from "../page";

describe("환불 및 청약철회 정책", () => {
  it("문서 제목과 시행일을 노출한다", () => {
    render(<RefundPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "환불 및 청약철회 정책" }),
    ).toBeInTheDocument();
    expect(screen.getByText(LEGAL.refundEffectiveDate)).toBeInTheDocument();
  });

  it("전자상거래법 표시의무 항목을 사업자 정보로 표기한다", () => {
    render(<RefundPage />);

    const info = screen.getByRole("region", { name: /사업자 정보/ });

    expect(within(info).getByText(LEGAL.operatorName)).toBeInTheDocument();
    expect(within(info).getByText(LEGAL.representative)).toBeInTheDocument();
    expect(
      within(info).getByText(LEGAL.businessRegistrationNumber),
    ).toBeInTheDocument();
    expect(
      within(info).getByText(LEGAL.mailOrderSalesNumber),
    ).toBeInTheDocument();
    expect(within(info).getByText(LEGAL.address)).toBeInTheDocument();
    expect(within(info).getByText(LEGAL.contactEmail)).toBeInTheDocument();
  });

  it("사업자 정보가 아직 미기입임을 이용자에게 숨기지 않는다", () => {
    render(<RefundPage />);

    expect(screen.getByRole("status")).toHaveTextContent(/준비 중/);
  });

  it("구독 해지 경로를 요금제 화면으로 안내한다", () => {
    render(<RefundPage />);

    expect(screen.getByRole("link", { name: /요금제/ })).toHaveAttribute(
      "href",
      "/billing",
    );
  });

  it("청약철회 기간과 사용분 정산 기준을 밝힌다", () => {
    render(<RefundPage />);

    // 7일(청약철회 기간)은 여러 조항에서 반복 언급되므로 존재 여부만 본다.
    expect(screen.getAllByText(/7일/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/일할/).length).toBeGreaterThan(0);
  });
});

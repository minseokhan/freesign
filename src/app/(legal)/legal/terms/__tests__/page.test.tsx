import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LEGAL } from "@/lib/legal";
import TermsPage from "../page";

describe("이용약관", () => {
  it("문서 제목과 시행일을 노출한다", () => {
    render(<TermsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "이용약관" }),
    ).toBeInTheDocument();
    expect(screen.getByText(LEGAL.termsEffectiveDate)).toBeInTheDocument();
  });

  it("AI 생성 계약서가 초안이며 법률 자문이 아님을 조항으로 못 박는다", () => {
    render(<TermsPage />);

    expect(screen.getByText(/법률 자문이 아닙니다/)).toBeInTheDocument();
  });

  it("전자서명이 공인전자서명이 아니며 입증력이 단계적임을 밝힌다", () => {
    render(<TermsPage />);

    expect(screen.getByText(/공인전자서명/)).toBeInTheDocument();
    expect(screen.getByText(/단독 기록/)).toBeInTheDocument();
    expect(screen.getByText(/맞서명/)).toBeInTheDocument();
  });

  it("유료 구독의 자동 갱신과 해지 경로를 안내한다", () => {
    render(<TermsPage />);

    expect(screen.getByText(/자동으로 갱신/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /요금제/ })).toHaveAttribute(
      "href",
      "/billing",
    );
  });

  it("데이터 소유권이 이용자에게 있음을 밝히고 내보내기를 안내한다", () => {
    render(<TermsPage />);

    expect(screen.getByText(/이용자에게 있습니다/)).toBeInTheDocument();
  });

  it("환불 정책과 개인정보처리방침을 링크로 연결한다", () => {
    render(<TermsPage />);

    expect(screen.getByRole("link", { name: /환불/ })).toHaveAttribute(
      "href",
      "/legal/refund",
    );
    expect(
      screen.getByRole("link", { name: /개인정보처리방침/ }),
    ).toHaveAttribute("href", "/legal/privacy");
  });
});

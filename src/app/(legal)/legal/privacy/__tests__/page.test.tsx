import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COLLECTED_DATA, DATA_PROCESSORS, LEGAL } from "@/lib/legal";
import PrivacyPage from "../page";

describe("개인정보처리방침", () => {
  it("문서 제목과 시행일을 노출한다", () => {
    render(<PrivacyPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "개인정보처리방침" }),
    ).toBeInTheDocument();
    expect(screen.getByText(LEGAL.privacyEffectiveDate)).toBeInTheDocument();
  });

  it("코드가 실제로 수집하는 항목을 빠짐없이 표로 고지한다", () => {
    render(<PrivacyPage />);

    const table = screen.getByRole("table", { name: /수집하는 개인정보 항목/ });

    for (const entry of COLLECTED_DATA) {
      expect(within(table).getByText(entry.category)).toBeInTheDocument();
      expect(within(table).getByText(entry.items)).toBeInTheDocument();
    }
  });

  it("국외 이전 대상을 전부 표로 고지한다 (개인정보보호법 제28조의8)", () => {
    render(<PrivacyPage />);

    const table = screen.getByRole("table", { name: /처리위탁 및 국외 이전/ });

    for (const processor of DATA_PROCESSORS) {
      expect(within(table).getByText(processor.name)).toBeInTheDocument();
      // 이전 국가는 여러 위탁사가 공유하므로(대부분 미국) 존재 여부만 본다.
      expect(
        within(table).getAllByText(processor.country).length,
      ).toBeGreaterThan(0);
    }
  });

  it("클라이언트·서명자 정보에 대한 수탁 관계를 명시한다", () => {
    render(<PrivacyPage />);

    expect(screen.getByText(/수탁자의 지위/)).toBeInTheDocument();
  });

  it("정보주체 권리 행사 경로로 내보내기·삭제를 안내한다", () => {
    render(<PrivacyPage />);

    const rights = screen.getByRole("region", { name: /정보주체의 권리/ });

    expect(
      within(rights).getByRole("link", { name: /설정/ }),
    ).toHaveAttribute("href", "/settings");
  });

  it("개인정보 보호책임자를 표기한다", () => {
    render(<PrivacyPage />);

    expect(screen.getByText(LEGAL.privacyOfficer.name)).toBeInTheDocument();
    expect(screen.getByText(LEGAL.privacyOfficer.email)).toBeInTheDocument();
  });

  it("계정 삭제 시 결제 기록만 보존됨을 보유기간에 밝힌다", () => {
    render(<PrivacyPage />);

    expect(screen.getByText(/대금결제.*5년/)).toBeInTheDocument();
  });
});

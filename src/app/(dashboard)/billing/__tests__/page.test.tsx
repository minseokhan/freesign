import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BillingPage from "../page";

vi.mock("@/lib/plan", () => ({
  getUserPlan: vi.fn().mockResolvedValue("free"),
}));

describe("BillingPage", () => {
  it("포털 진입 실패는 오류로 알린다", async () => {
    render(
      await BillingPage({ searchParams: Promise.resolve({ portal: "no_customer" }) }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "결제 고객 정보가 아직 연결되지 않아",
    );
  });

  // 결제 미구성은 사용자 잘못도 장애도 아니다 — 오류(alert)가 아니라 상태(status)로 알린다.
  it("결제 미구성은 오류가 아니라 안내로 알린다", async () => {
    render(
      await BillingPage({
        searchParams: Promise.resolve({ portal: "not_configured" }),
      }),
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("결제 기능을 준비하고 있어요");
  });

  it("사유가 없으면 아무 배너도 띄우지 않는다", async () => {
    render(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

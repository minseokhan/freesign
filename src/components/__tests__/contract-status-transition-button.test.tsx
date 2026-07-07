import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { transitionContractStatus } from "@/app/(dashboard)/contracts/actions";
import { ContractStatusTransitionButton } from "@/components/contract-status-transition-button";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/app/(dashboard)/contracts/actions", () => ({
  transitionContractStatus: vi.fn(),
}));

describe("ContractStatusTransitionButton", () => {
  const refresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      refresh,
    } as unknown as ReturnType<typeof useRouter>);
  });

  it("shows success feedback after a status transition", async () => {
    vi.mocked(transitionContractStatus).mockResolvedValue({
      ok: true,
      id: "contract-1",
    });

    render(
      <ContractStatusTransitionButton
        contractId="contract-1"
        status="active"
        label="진행 시작"
        variant="primary"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "진행 시작" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "계약 상태를 변경했습니다.",
    );
    expect(transitionContractStatus).toHaveBeenCalledWith("contract-1", "active");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows error feedback when a status transition fails", async () => {
    vi.mocked(transitionContractStatus).mockResolvedValue({
      ok: false,
      error: "허용되지 않는 계약 상태 전이입니다.",
    });

    render(
      <ContractStatusTransitionButton
        contractId="contract-1"
        status="done"
        label="완료 처리"
        variant="primary"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "완료 처리" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "허용되지 않는 계약 상태 전이입니다.",
      );
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

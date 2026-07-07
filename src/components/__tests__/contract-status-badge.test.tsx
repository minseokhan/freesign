import { render, screen } from "@testing-library/react";

import {
  CONTRACT_STATUS_OPTIONS,
  ContractStatusBadge,
} from "@/components/contract-status-badge";

describe("ContractStatusBadge", () => {
  it("renders Korean labels for every supported contract status", () => {
    render(
      <div>
        {CONTRACT_STATUS_OPTIONS.filter((status) => status.value !== "all").map(
          (status) => (
            <ContractStatusBadge key={status.value} status={status.value} />
          ),
        )}
      </div>,
    );

    expect(screen.getByText("초안")).toBeInTheDocument();
    expect(screen.getByText("서명완료")).toBeInTheDocument();
    expect(screen.getByText("진행중")).toBeInTheDocument();
    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.getByText("취소")).toBeInTheDocument();
  });

  it("falls back to the neutral 초안 label for unknown status values", () => {
    render(<ContractStatusBadge status="archived" />);

    expect(screen.getByText("초안")).toHaveClass("bg-status-neutral-bg");
  });
});

import { render, screen } from "@testing-library/react";

import {
  PAYMENT_STATUS_OPTIONS,
  PaymentStatusBadge,
} from "@/components/payment-status-badge";

describe("PaymentStatusBadge", () => {
  it("renders Korean labels for every supported payment status", () => {
    render(
      <div>
        {PAYMENT_STATUS_OPTIONS.filter((status) => status.value !== "all").map(
          (status) => (
            <PaymentStatusBadge key={status.value} status={status.value} />
          ),
        )}
      </div>,
    );

    expect(screen.getByText("초안")).toBeInTheDocument();
    expect(screen.getByText("미수")).toBeInTheDocument();
    expect(screen.getByText("입금완료")).toBeInTheDocument();
  });

  it("shows overdue as a derived danger badge without adding a stored status", () => {
    render(<PaymentStatusBadge status="unpaid" overdue />);

    expect(screen.getByText("지연")).toHaveClass("bg-status-overdue-bg");
  });

  it("falls back to the neutral 초안 label for unknown status values", () => {
    render(<PaymentStatusBadge status="archived" />);

    expect(screen.getByText("초안")).toHaveClass("bg-status-neutral-bg");
  });
});

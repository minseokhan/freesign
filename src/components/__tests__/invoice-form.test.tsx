import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInvoice } from "@/app/(dashboard)/invoices/actions";
import { InvoiceForm } from "@/components/invoice-form";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/app/(dashboard)/invoices/actions", () => ({
  createInvoice: vi.fn(),
}));

const contract = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "IT 용역계약서",
  amount: 3_000_000,
  clientName: "해커스",
};

describe("InvoiceForm", () => {
  const push = vi.fn();
  const refresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      push,
      refresh,
    } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(createInvoice).mockResolvedValue({ ok: true, id: "invoice-1" });
  });

  // 회귀: 금액을 바꾸면 표시값이 "5,000,000"처럼 콤마 포맷이 되는데, 이 포맷 문자열이
  // 그대로 검증에 들어가면 z.coerce.number가 NaN으로 보고 "Invalid input"으로 거부한다.
  // setValueAs로 콤마를 제거해 숫자로 정규화되어야 발행이 통과한다.
  it("submits an edited, comma-formatted amount as a clean integer", async () => {
    render(
      <InvoiceForm
        contract={contract}
        defaultIssueDate="2026-07-14"
        defaultDueDate="2026-08-13"
        defaultWithholdingType="wt_8_8"
      />,
    );

    const amountInput = screen.getByLabelText("청구 금액");

    // 사용자가 금액을 5,000,000으로 변경(입력 → blur).
    fireEvent.change(amountInput, { target: { value: "5000000" } });
    expect(amountInput).toHaveValue("5,000,000");
    fireEvent.blur(amountInput);

    fireEvent.click(screen.getByRole("button", { name: "발행" }));

    await waitFor(() => {
      expect(createInvoice).toHaveBeenCalledTimes(1);
    });

    const submitted = vi.mocked(createInvoice).mock.calls[0][0] as {
      amount: unknown;
    };
    expect(submitted.amount).toBe(5_000_000);
    expect(typeof submitted.amount).toBe("number");
    expect(push).toHaveBeenCalledWith("/invoices/invoice-1");
  });

  it("keeps the default contract amount valid on submit without edits", async () => {
    render(
      <InvoiceForm
        contract={contract}
        defaultIssueDate="2026-07-14"
        defaultDueDate="2026-08-13"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "발행" }));

    await waitFor(() => {
      expect(createInvoice).toHaveBeenCalledTimes(1);
    });

    const submitted = vi.mocked(createInvoice).mock.calls[0][0] as {
      amount: unknown;
    };
    expect(submitted.amount).toBe(3_000_000);
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendInvoice } from "@/app/(dashboard)/invoices/actions";
import { SendInvoiceButton } from "@/components/send-invoice-button";

vi.mock("@/app/(dashboard)/invoices/actions", () => ({
  sendInvoice: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const invoiceId = "invoice-1";

describe("SendInvoiceButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("확인 전에는 발송하지 않고, 수신 이메일을 확인 창에 보여준다", () => {
    render(
      <SendInvoiceButton
        invoiceId={invoiceId}
        recipientEmail="client@example.test"
        mode="send"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "청구서 발송" }));

    expect(screen.getByText(/client@example.test/)).toBeInTheDocument();
    expect(sendInvoice).not.toHaveBeenCalled();
  });

  it("확인하면 발송하고 성공 메시지를 보여준다", async () => {
    vi.mocked(sendInvoice).mockResolvedValue({
      ok: true,
      id: invoiceId,
      shareUrl: "https://maedeup.example/invoice/tok-1",
      emailed: true,
    });

    render(
      <SendInvoiceButton
        invoiceId={invoiceId}
        recipientEmail="client@example.test"
        mode="send"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "청구서 발송" }));
    fireEvent.click(screen.getByRole("button", { name: "발송" }));

    await waitFor(() => {
      expect(sendInvoice).toHaveBeenCalledWith(invoiceId);
    });
    expect(
      await screen.findByText(/client@example.test 으로 청구서를 보냈습니다/),
    ).toBeInTheDocument();
  });

  it("이메일이 없으면 링크만 발급된다고 안내하고, 발급된 링크를 보여준다", async () => {
    vi.mocked(sendInvoice).mockResolvedValue({
      ok: true,
      id: invoiceId,
      shareUrl: "https://maedeup.example/invoice/tok-2",
      emailed: false,
    });

    render(
      <SendInvoiceButton invoiceId={invoiceId} recipientEmail={null} mode="send" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "청구서 발송" }));
    expect(screen.getByText(/이메일이 등록되어 있지 않아/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "발송" }));

    expect(
      await screen.findByDisplayValue("https://maedeup.example/invoice/tok-2"),
    ).toBeInTheDocument();
  });

  it("실패하면 오류를 보여준다", async () => {
    vi.mocked(sendInvoice).mockResolvedValue({
      ok: false,
      error: "이미 정산된 인보이스는 발송할 수 없습니다.",
    });

    render(
      <SendInvoiceButton
        invoiceId={invoiceId}
        recipientEmail="client@example.test"
        mode="send"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "청구서 발송" }));
    fireEvent.click(screen.getByRole("button", { name: "발송" }));

    expect(
      await screen.findByText("이미 정산된 인보이스는 발송할 수 없습니다."),
    ).toBeInTheDocument();
  });

  it("재발송 모드는 이전 링크가 무효화된다고 알린다", () => {
    render(
      <SendInvoiceButton
        invoiceId={invoiceId}
        recipientEmail="client@example.test"
        mode="resend"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "청구서 재발송" }));

    expect(screen.getByText(/이전 링크는 무효화됩니다/)).toBeInTheDocument();
  });
});

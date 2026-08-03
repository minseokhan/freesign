import { describe, expect, it } from "vitest";

import { parseInvoiceView } from "@/lib/invoices/public-view";

const activeView = {
  state: "active",
  invoice_id: "invoice-1",
  payment_status: "unpaid",
  amount: 1_000_000,
  withholding_type: "wt_3_3",
  withholding_amount: 33_000,
  net_amount: 967_000,
  issue_date: "2026-08-01",
  due_date: "2026-08-31",
  paid_at: null,
  contract_title: "웹사이트 제작",
  client_name: "Acme",
  sender_name: "한프리",
  bank_name: "국민은행",
  bank_account_number: "123456-78-901234",
  bank_account_holder: "김프리",
  expires_at: "2026-11-29T00:00:00.000Z",
};

describe("parseInvoiceView", () => {
  it("활성 응답을 PDF 모델과 함께 매핑한다", () => {
    const parsed = parseInvoiceView(activeView);

    expect(parsed?.state).toBe("active");
    expect(parsed?.state === "active" && parsed.senderName).toBe("한프리");
    expect(parsed?.state === "active" && parsed.document.netAmountLabel).toBe(
      "₩967,000",
    );
    expect(parsed?.state === "active" && parsed.document.bankAccount).toEqual({
      bankName: "국민은행",
      accountNumber: "123456-78-901234",
      accountHolder: "김프리",
    });
    expect(parsed?.state === "active" && parsed.document.invoiceNumber).toBe(
      "invoice-1",
    );
  });

  it("계좌가 하나도 없으면 bankAccount는 null이다", () => {
    const parsed = parseInvoiceView({
      ...activeView,
      bank_name: null,
      bank_account_number: null,
      bank_account_holder: null,
    });

    expect(parsed?.state === "active" && parsed.document.bankAccount).toBeNull();
  });

  it("만료·회수 상태를 그대로 전달한다", () => {
    expect(parseInvoiceView({ state: "expired" })).toEqual({ state: "expired" });
    expect(parseInvoiceView({ state: "revoked" })).toEqual({ state: "revoked" });
  });

  it("null·형식 불일치는 null로 떨어진다", () => {
    expect(parseInvoiceView(null)).toBeNull();
    expect(parseInvoiceView("nope")).toBeNull();
    expect(parseInvoiceView({ state: "who-knows" })).toBeNull();
    // active인데 필수 금액 필드가 없으면 렌더할 수 없다.
    expect(parseInvoiceView({ state: "active", invoice_id: "invoice-1" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  INVOICE_PDF_DISCLAIMER,
  mapBankAccount,
  mapInvoicePdfProps,
} from "@/lib/invoices/pdf";

const invoice = {
  id: "invoice-1",
  amount: 3000000,
  issue_date: "2026-07-01",
  due_date: "2026-07-31",
  withholding_type: "wt_3_3" as const,
  withholding_amount: 99000,
  net_amount: 2901000,
  payment_status: "unpaid" as const,
  paid_at: null,
};

describe("mapInvoicePdfProps", () => {
  it("maps stored invoice snapshots into a Korean PDF document model", () => {
    const document = mapInvoicePdfProps({
      invoice,
      clientName: "테스트 클라이언트",
      contractTitle: "브랜드 웹사이트 제작",
      bankAccount: {
        bankName: "국민은행",
        accountNumber: "123-456-789",
        accountHolder: "홍길동",
      },
    });

    expect(document.title).toBe("인보이스 invoice-1");
    expect(document.invoiceNumber).toBe("invoice-1");
    expect(document.clientName).toBe("테스트 클라이언트");
    expect(document.contractTitle).toBe("브랜드 웹사이트 제작");
    expect(document.amountLabel).toBe("₩3,000,000");
    expect(document.withholdingTypeLabel).toBe("3.3%");
    expect(document.withholdingAmountLabel).toBe("₩99,000");
    expect(document.netAmountLabel).toBe("₩2,901,000");
    expect(document.issueDateLabel).toBe("2026.07.01");
    expect(document.dueDateLabel).toBe("2026.07.31");
    expect(document.paymentStatusLabel).toBe("미수");
    expect(document.paidAtLabel).toBeNull();
    expect(document.showWithholdingDetails).toBe(true);
    expect(document.bankAccount).toEqual({
      bankName: "국민은행",
      accountNumber: "123-456-789",
      accountHolder: "홍길동",
    });
    expect(document.disclaimer).toBe(INVOICE_PDF_DISCLAIMER);
  });

  it("does not recalculate or show withholding details for none snapshots", () => {
    const document = mapInvoicePdfProps({
      invoice: {
        ...invoice,
        amount: 1000000,
        withholding_type: "none",
        withholding_amount: 0,
        net_amount: 1000000,
        payment_status: "paid",
        paid_at: "2026-07-08T02:30:00.000Z",
      },
      clientName: null,
      contractTitle: null,
      bankAccount: null,
    });

    expect(document.clientName).toBe("클라이언트 없음");
    expect(document.contractTitle).toBe("계약 없음");
    expect(document.amountLabel).toBe("₩1,000,000");
    expect(document.withholdingTypeLabel).toBe("없음");
    expect(document.withholdingAmountLabel).toBe("₩0");
    expect(document.netAmountLabel).toBe("₩1,000,000");
    expect(document.paymentStatusLabel).toBe("입금완료");
    expect(document.paidAtLabel).toBe("2026. 07. 08. 오전 11:30");
    expect(document.showWithholdingDetails).toBe(false);
    expect(document.bankAccount).toBeNull();
  });
});

describe("mapBankAccount", () => {
  it("계좌 정보가 하나도 없으면 null을 반환한다", () => {
    expect(mapBankAccount(null)).toBeNull();
    expect(
      mapBankAccount({
        bank_name: null,
        bank_account_number: null,
        bank_account_holder: null,
      }),
    ).toBeNull();
  });

  it("일부만 있으면 나머지는 '등록되지 않음'으로 채운다", () => {
    expect(
      mapBankAccount({
        bank_name: "국민은행",
        bank_account_number: null,
        bank_account_holder: "홍길동",
      }),
    ).toEqual({
      bankName: "국민은행",
      accountNumber: "등록되지 않음",
      accountHolder: "홍길동",
    });
  });
});

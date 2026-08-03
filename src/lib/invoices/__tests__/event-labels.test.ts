import { describe, expect, it } from "vitest";

import {
  formatInvoiceEventActor,
  invoiceEventLabel,
} from "@/lib/invoices/event-labels";

describe("invoiceEventLabel", () => {
  it("maps invoice event types to Korean labels", () => {
    expect(invoiceEventLabel("invoice.issued")).toBe("인보이스 발행");
    expect(invoiceEventLabel("invoice.payment_changed")).toBe("정산 상태 변경");
    expect(invoiceEventLabel("invoice.status_changed")).toBe("정산 상태 변경");
    expect(invoiceEventLabel("invoice.payment_marked")).toBe("입금 처리");
    expect(invoiceEventLabel("invoice.draft_generated")).toBe(
      "반복 인보이스 초안 생성",
    );
    expect(invoiceEventLabel("invoice.sent")).toBe("청구서 발송");
    expect(invoiceEventLabel("invoice.dunning_sent")).toBe("미수금 독촉 발송");
  });

  it("falls back to the raw type for unknown events", () => {
    expect(invoiceEventLabel("invoice.unknown")).toBe("invoice.unknown");
  });
});

describe("formatInvoiceEventActor", () => {
  it("labels the owner uuid as 소유자", () => {
    expect(
      formatInvoiceEventActor("ae7b9923-9ad9-42b3-9316-ac4ac8005155"),
    ).toBe("소유자");
  });

  it("labels cron actors as 자동 실행", () => {
    expect(formatInvoiceEventActor("cron:recurring")).toBe("자동 실행");
    expect(formatInvoiceEventActor("cron:dunning")).toBe("자동 실행");
  });

  it("keeps other actors as-is", () => {
    expect(formatInvoiceEventActor("system")).toBe("system");
  });
});

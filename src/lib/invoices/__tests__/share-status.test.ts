import { describe, expect, it } from "vitest";

import { deriveInvoiceShareStatus } from "@/lib/invoices/share-status";

const token = {
  recipient_email: "client@example.test",
  last_sent_at: "2026-08-03T00:00:00.000Z",
  first_viewed_at: null,
  expires_at: "2026-11-29T00:00:00.000Z",
};

describe("deriveInvoiceShareStatus", () => {
  it("토큰이 없으면 null (아직 한 번도 발송하지 않음)", () => {
    expect(deriveInvoiceShareStatus(null, [])).toBeNull();
  });

  it("최근 발송 이후 invoice.sent가 있으면 전달됨으로 본다", () => {
    const status = deriveInvoiceShareStatus(token, [
      { event_type: "invoice.sent", created_at: "2026-08-03T00:00:01.000Z" },
    ]);

    expect(status?.delivered).toBe(true);
    expect(status?.recipientEmail).toBe("client@example.test");
  });

  it("독촉 메일로 링크가 나간 것도 전달로 본다", () => {
    const status = deriveInvoiceShareStatus(token, [
      {
        event_type: "invoice.dunning_sent",
        created_at: "2026-08-03T00:00:01.000Z",
      },
    ]);

    expect(status?.delivered).toBe(true);
  });

  it("메일 발송이 실패했으면(도달 이벤트 없음) 전달되지 않은 것으로 본다", () => {
    const status = deriveInvoiceShareStatus(token, [
      { event_type: "invoice.issued", created_at: "2026-08-03T00:00:01.000Z" },
    ]);

    expect(status?.delivered).toBe(false);
  });

  it("이전 발송의 도달 기록은 현재 링크의 전달로 치지 않는다", () => {
    // 재발송으로 토큰이 교체됐는데 이번 메일은 실패한 경우 —
    // 예전 invoice.sent가 남아 있다고 "전달됨"으로 표시하면 거짓말이 된다.
    const status = deriveInvoiceShareStatus(token, [
      { event_type: "invoice.sent", created_at: "2026-08-01T00:00:00.000Z" },
    ]);

    expect(status?.delivered).toBe(false);
  });

  it("열람 시각과 만료를 그대로 전달한다", () => {
    const status = deriveInvoiceShareStatus(
      { ...token, first_viewed_at: "2026-08-04T01:00:00.000Z" },
      [],
    );

    expect(status?.firstViewedAt).toBe("2026-08-04T01:00:00.000Z");
    expect(status?.expiresAt).toBe("2026-11-29T00:00:00.000Z");
  });

  it("last_sent_at이 없으면 전달로 보지 않는다", () => {
    const status = deriveInvoiceShareStatus({ ...token, last_sent_at: null }, [
      { event_type: "invoice.sent", created_at: "2026-08-03T00:00:01.000Z" },
    ]);

    expect(status?.delivered).toBe(false);
  });
});

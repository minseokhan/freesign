import { describe, expect, it } from "vitest";

import { computeInvoiceShareExpiry } from "@/lib/invoices/share-expiry";

const now = new Date("2026-08-03T00:00:00.000Z");

describe("computeInvoiceShareExpiry", () => {
  it("지급기한 + 90일을 만료로 삼는다", () => {
    // 2026-08-31 + 90일 = 2026-11-29
    expect(computeInvoiceShareExpiry("2026-08-31", now)).toBe(
      "2026-11-29T00:00:00.000Z",
    );
  });

  it("지급기한이 임박·경과했어도 최소 30일은 보장한다", () => {
    // 이미 지난 기한이라 due+90일이 now+30일보다 이르다 → 하한이 이긴다.
    expect(computeInvoiceShareExpiry("2026-01-01", now)).toBe(
      "2026-09-02T00:00:00.000Z",
    );
  });

  it("지급기한이 없거나 형식이 어긋나면 하한(30일)으로 떨어진다", () => {
    expect(computeInvoiceShareExpiry("", now)).toBe("2026-09-02T00:00:00.000Z");
    expect(computeInvoiceShareExpiry("not-a-date", now)).toBe(
      "2026-09-02T00:00:00.000Z",
    );
  });

  it("RPC 상한(400일)을 넘지 않는다", () => {
    const expiry = new Date(computeInvoiceShareExpiry("2030-01-01", now));
    const maxAllowed = new Date(now.getTime() + 400 * 86400_000);

    expect(expiry.getTime()).toBeLessThan(maxAllowed.getTime());
  });
});

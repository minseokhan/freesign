import { describe, expect, it } from "vitest";

import {
  deriveDueStatus,
  formatKRW,
  getWithholdingTypeLabel,
  sumTaxSummary,
  topChannelsByRevenue,
  topClientsByRevenue,
  type TaxSummaryRow
} from "@/lib/metrics";

describe("formatKRW", () => {
  it("formats integer won amounts with a KRW prefix and thousand separators", () => {
    expect(formatKRW(1_000_000)).toBe("₩1,000,000");
  });

  it("formats zero consistently", () => {
    expect(formatKRW(0)).toBe("₩0");
  });

  it("formats large safe integers", () => {
    expect(formatKRW(987_654_321_000)).toBe("₩987,654,321,000");
  });

  it("preserves the sign for negative display adjustments", () => {
    expect(formatKRW(-12_345)).toBe("-₩12,345");
  });
});

describe("deriveDueStatus", () => {
  it("returns paid regardless of due date", () => {
    expect(
      deriveDueStatus(
        { dueDate: "2026-01-01", paymentStatus: "paid" },
        new Date("2026-07-07T12:00:00.000Z")
      )
    ).toBe("paid");
  });

  it("marks unpaid invoices before KST today as overdue", () => {
    expect(
      deriveDueStatus(
        { dueDate: "2026-07-06", paymentStatus: "unpaid" },
        new Date("2026-07-07T03:00:00.000Z")
      )
    ).toBe("overdue");
  });

  it("marks unpaid invoices due today as due soon", () => {
    expect(
      deriveDueStatus(
        { dueDate: "2026-07-07", paymentStatus: "unpaid" },
        new Date("2026-07-07T03:00:00.000Z")
      )
    ).toBe("due_soon");
  });

  it("marks unpaid invoices inside the due-soon window as due soon", () => {
    expect(
      deriveDueStatus(
        { dueDate: "2026-07-14", paymentStatus: "unpaid" },
        new Date("2026-07-07T03:00:00.000Z")
      )
    ).toBe("due_soon");
  });

  it("marks unpaid invoices beyond the due-soon window as upcoming", () => {
    expect(
      deriveDueStatus(
        { dueDate: "2026-07-15", paymentStatus: "unpaid" },
        new Date("2026-07-07T03:00:00.000Z")
      )
    ).toBe("upcoming");
  });

  it("uses KST date boundaries instead of UTC date boundaries", () => {
    expect(
      deriveDueStatus(
        { dueDate: "2026-07-06", paymentStatus: "unpaid" },
        new Date("2026-07-06T16:00:00.000Z")
      )
    ).toBe("overdue");
  });
});

describe("topChannelsByRevenue", () => {
  it("sorts already aggregated revenue rows in descending order and applies the limit", () => {
    expect(
      topChannelsByRevenue(
        [
          { channel: "direct", revenue: 300_000 },
          { channel: "linkedin", revenue: 900_000 },
          { channel: "instagram", revenue: 500_000 }
        ],
        2
      )
    ).toEqual([
      { channel: "linkedin", revenue: 900_000 },
      { channel: "instagram", revenue: 500_000 }
    ]);
  });

  it("keeps original order for equal revenue rows", () => {
    expect(
      topChannelsByRevenue(
        [
          { channel: "instagram", revenue: 500_000 },
          { channel: "youtube", revenue: 500_000 },
          { channel: "direct", revenue: 100_000 }
        ],
        3
      )
    ).toEqual([
      { channel: "instagram", revenue: 500_000 },
      { channel: "youtube", revenue: 500_000 },
      { channel: "direct", revenue: 100_000 }
    ]);
  });

  it("does not mutate the input rows", () => {
    const rows = [
      { channel: "direct", revenue: 300_000 },
      { channel: "linkedin", revenue: 900_000 },
      { channel: "instagram", revenue: 500_000 }
    ];
    const original = [...rows];

    topChannelsByRevenue(rows, 2);

    expect(rows).toEqual(original);
  });
});

describe("topClientsByRevenue", () => {
  it("sorts client revenue rows in descending order and applies the limit", () => {
    expect(
      topClientsByRevenue(
        [
          { clientId: "a", clientName: "가", revenue: 300_000 },
          { clientId: "b", clientName: "나", revenue: 900_000 },
          { clientId: "c", clientName: "다", revenue: 500_000 }
        ],
        2
      )
    ).toEqual([
      { clientId: "b", clientName: "나", revenue: 900_000 },
      { clientId: "c", clientName: "다", revenue: 500_000 }
    ]);
  });

  it("keeps original order for equal revenue rows", () => {
    expect(
      topClientsByRevenue(
        [
          { clientId: "a", clientName: "가", revenue: 500_000 },
          { clientId: "b", clientName: "나", revenue: 500_000 }
        ],
        2
      )
    ).toEqual([
      { clientId: "a", clientName: "가", revenue: 500_000 },
      { clientId: "b", clientName: "나", revenue: 500_000 }
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(topClientsByRevenue([], 5)).toEqual([]);
  });
});

describe("sumTaxSummary", () => {
  const rows: TaxSummaryRow[] = [
    {
      withholdingType: "wt_3_3",
      invoiceCount: 2,
      grossAmount: 2_000_000,
      withholdingAmount: 66_000,
      netAmount: 1_934_000
    },
    {
      withholdingType: "none",
      invoiceCount: 1,
      grossAmount: 500_000,
      withholdingAmount: 0,
      netAmount: 500_000
    }
  ];

  it("adds up counts and amounts across withholding types", () => {
    expect(sumTaxSummary(rows)).toEqual({
      invoiceCount: 3,
      grossAmount: 2_500_000,
      withholdingAmount: 66_000,
      netAmount: 2_434_000
    });
  });

  it("returns zeroed totals for empty input", () => {
    expect(sumTaxSummary([])).toEqual({
      invoiceCount: 0,
      grossAmount: 0,
      withholdingAmount: 0,
      netAmount: 0
    });
  });
});

describe("getWithholdingTypeLabel", () => {
  it("maps known withholding types to Korean rate labels", () => {
    expect(getWithholdingTypeLabel("wt_3_3")).toBe("3.3%");
    expect(getWithholdingTypeLabel("wt_8_8")).toBe("8.8%");
    expect(getWithholdingTypeLabel("none")).toBe("없음");
  });

  it("falls back to 없음 for unknown types", () => {
    expect(getWithholdingTypeLabel("unexpected")).toBe("없음");
  });
});

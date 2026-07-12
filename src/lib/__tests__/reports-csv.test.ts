import { describe, expect, it } from "vitest";

import { serializeTaxLedgerCsv, type ReportLedgerRow } from "@/lib/reports-csv";

const HEADER =
  "﻿입금일,발행일,클라이언트,채널,청구액(원),원천징수유형,원천징수액(원),실지급액(원)";

describe("serializeTaxLedgerCsv", () => {
  it("writes one row per invoice with KST paid date, Korean labels, and a totals row", () => {
    const rows: ReportLedgerRow[] = [
      {
        paidAt: "2026-03-15T05:00:00.000Z",
        issueDate: "2026-03-01",
        clientName: "김클라",
        channel: "direct",
        amount: 1_000_000,
        withholdingType: "wt_3_3",
        withholdingAmount: 33_000,
        netAmount: 967_000
      },
      {
        paidAt: "2026-05-10T20:00:00.000Z",
        issueDate: "2026-05-01",
        clientName: "이고객",
        channel: "instagram",
        amount: 500_000,
        withholdingType: "none",
        withholdingAmount: 0,
        netAmount: 500_000
      }
    ];

    expect(serializeTaxLedgerCsv(rows)).toBe(
      [
        HEADER,
        "2026-03-15,2026-03-01,김클라,직거래,1000000,3.3%,33000,967000",
        "2026-05-11,2026-05-01,이고객,인스타그램,500000,없음,0,500000",
        "합계,,,,1500000,,33000,1467000"
      ].join("\r\n")
    );
  });

  it("escapes commas, quotes, and newlines in text fields", () => {
    const rows: ReportLedgerRow[] = [
      {
        paidAt: "2026-01-02T00:00:00.000Z",
        issueDate: "2026-01-01",
        clientName: '추천, "파트너"\nA',
        channel: "referral",
        amount: 100_000,
        withholdingType: "wt_8_8",
        withholdingAmount: 8_800,
        netAmount: 91_200
      }
    ];

    expect(serializeTaxLedgerCsv(rows)).toBe(
      [
        HEADER,
        '2026-01-02,2026-01-01,"추천, ""파트너""\nA",추천,100000,8.8%,8800,91200',
        "합계,,,,100000,,8800,91200"
      ].join("\r\n")
    );
  });

  it("emits only the header and a zeroed totals row for empty input", () => {
    expect(serializeTaxLedgerCsv([])).toBe(
      [HEADER, "합계,,,,0,,0,0"].join("\r\n")
    );
  });
});

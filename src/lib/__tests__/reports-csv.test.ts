import { describe, expect, it } from "vitest";

import { serializeReportCsv } from "@/lib/reports-csv";

describe("serializeReportCsv", () => {
  it("prefixes UTF-8 BOM and writes raw integer revenue values", () => {
    expect(
      serializeReportCsv([
        { channelLabel: "직거래", revenue: 1200000 },
        { channelLabel: "링크드인", revenue: 350000 },
      ]),
    ).toBe("\uFEFF채널,수익(원)\r\n직거래,1200000\r\n링크드인,350000");
  });

  it("escapes commas, quotes, and newlines in CSV fields", () => {
    expect(
      serializeReportCsv([
        { channelLabel: '추천, "파트너"\nA', revenue: 50000 },
      ]),
    ).toBe(
      '\uFEFF채널,수익(원)\r\n"추천, ""파트너""\nA",50000',
    );
  });
});

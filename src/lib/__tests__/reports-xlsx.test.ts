import { describe, expect, it } from "vitest";

import {
  buildTaxLedgerSheet,
  type ReportLedgerRow,
} from "@/lib/reports-xlsx";

const rows: ReportLedgerRow[] = [
  {
    paidAt: "2026-03-15T05:00:00.000Z",
    issueDate: "2026-03-01",
    clientName: "김클라",
    channel: "direct",
    amount: 1_000_000,
    withholdingType: "wt_3_3",
    withholdingAmount: 33_000,
    netAmount: 967_000,
  },
  {
    // KST로는 다음 날(2026-05-11)로 넘어가는 시각.
    paidAt: "2026-05-10T20:00:00.000Z",
    issueDate: "2026-05-01",
    clientName: "이고객",
    channel: "instagram",
    amount: 500_000,
    withholdingType: "none",
    withholdingAmount: 0,
    netAmount: 500_000,
  },
];

const options = { year: 2026, generatedAt: "2026-07-29T01:00:00.000Z" };

describe("buildTaxLedgerSheet", () => {
  it("제목은 가운데 정렬·큰 글자·테두리로 표 위에 세운다", () => {
    const { sheetData } = buildTaxLedgerSheet(rows, options);
    const title = sheetData[0]![0]!;

    expect(title).toMatchObject({
      value: "FreeSign 세무 원장 · 2026년",
      fontWeight: "bold",
      align: "center",
      alignVertical: "center",
      borderColor: expect.any(String),
      backgroundColor: expect.any(String),
      columnSpan: 8,
    });
    expect(title.fontSize).toBeGreaterThan(14);
    expect(title.height).toBeGreaterThan(24);
    // 병합된 칸은 null로 채워야 뒤 열이 밀리지 않는다.
    expect(sheetData[0]).toHaveLength(8);
    expect(sheetData[0]!.slice(1).every((cell) => cell === null)).toBe(true);
  });

  it("내보낸 날짜 줄은 오른쪽으로 붙인다", () => {
    const { sheetData } = buildTaxLedgerSheet(rows, options);
    const meta = sheetData[1]![0]!;

    expect(meta.value).toContain("입금일 기준");
    expect(meta.value).toContain("2026-07-29");
    expect(meta.align).toBe("right");
    expect(meta.columnSpan).toBe(8);
  });

  it("표 머리글은 굵게·배경·테두리로 구분한다", () => {
    const { sheetData } = buildTaxLedgerSheet(rows, options);
    const header = sheetData[3]!;

    expect(header.map((cell) => cell?.value)).toEqual([
      "입금일",
      "발행일",
      "클라이언트",
      "채널",
      "청구액(원)",
      "원천징수유형",
      "원천징수액(원)",
      "실지급액(원)",
    ]);
    expect(header[0]).toMatchObject({
      fontWeight: "bold",
      backgroundColor: expect.any(String),
      borderColor: expect.any(String),
      align: "center",
    });
    expect(header[0]?.height).toBeGreaterThan(18);
  });

  it("날짜는 KST 달력 기준 Date, 금액은 천 단위 서식 숫자로 넣는다", () => {
    const { sheetData } = buildTaxLedgerSheet(rows, options);
    const [first, second] = [sheetData[4]!, sheetData[5]!];

    expect(first[0]).toMatchObject({
      value: new Date(Date.UTC(2026, 2, 15)),
      type: Date,
      format: "yyyy-mm-dd",
    });
    // 05-10T20:00Z는 KST로 05-11이다.
    expect(second[0]?.value).toEqual(new Date(Date.UTC(2026, 4, 11)));

    expect(first[4]).toMatchObject({
      value: 1_000_000,
      type: Number,
      format: "#,##0",
    });
    expect(first[3]?.value).toBe("직거래");
    expect(first[5]?.value).toBe("3.3%");
    expect(second[5]?.value).toBe("없음");
  });

  it("내용이 있는 칸은 가로·세로 모두 가운데 정렬하고 행 높이를 넉넉히 준다", () => {
    const { sheetData } = buildTaxLedgerSheet(rows, options);
    const body = sheetData[4]!;

    expect(body.every((cell) => cell?.align === "center")).toBe(true);
    expect(body.every((cell) => cell?.alignVertical === "center")).toBe(true);
    expect(body[0]?.height).toBeGreaterThan(18);
    expect(sheetData.at(-1)?.[0]?.height).toBeGreaterThan(18);
  });

  it("표의 모든 칸에 테두리를 두른다", () => {
    const { sheetData } = buildTaxLedgerSheet(rows, options);
    const tableRows = sheetData.slice(3);

    for (const row of tableRows) {
      for (const cell of row) {
        expect(cell?.borderStyle).toBe("thin");
        expect(cell?.borderColor).toBe("#94A3B8");
      }
    }
  });

  it("마지막에 합계 행을 굵게 넣는다", () => {
    const { sheetData } = buildTaxLedgerSheet(rows, options);
    const totals = sheetData.at(-1)!;

    expect(totals[0]).toMatchObject({ value: "합계", fontWeight: "bold" });
    expect(totals[4]).toMatchObject({ value: 1_500_000, fontWeight: "bold" });
    expect(totals[6]?.value).toBe(33_000);
    expect(totals[7]?.value).toBe(1_467_000);
  });

  it("입금 내역이 없으면 안내 행만 둔다", () => {
    const { sheetData } = buildTaxLedgerSheet([], options);

    expect(sheetData.at(-1)?.[0]?.value).toBe(
      "해당 연도에 입금 완료된 인보이스가 없습니다.",
    );
  });

  it("열 너비를 지정해 값이 잘리지 않게 한다", () => {
    const { columns } = buildTaxLedgerSheet(rows, options);

    expect(columns).toHaveLength(8);
    expect(columns.every((column) => column.width > 0)).toBe(true);
  });
});

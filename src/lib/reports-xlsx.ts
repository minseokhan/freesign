import { getWithholdingTypeLabel } from "@/lib/metrics";

export interface ReportLedgerRow {
  paidAt: string;
  issueDate: string;
  clientName: string;
  channel: string;
  amount: number;
  withholdingType: string;
  withholdingAmount: number;
  netAmount: number;
}

export type SheetCell = {
  value?: string | number | Date;
  type?: typeof String | typeof Number | typeof Date;
  format?: string;
  fontWeight?: "bold";
  fontSize?: number;
  align?: "left" | "center" | "right";
  alignVertical?: "top" | "center" | "bottom";
  height?: number;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  borderStyle?: "thin" | "medium";
  columnSpan?: number;
};

// 병합(columnSpan)된 자리는 null로 채워야 뒤 열이 밀리지 않는다.
export type SheetRow = (SheetCell | null)[];

export type SheetColumn = { width: number };

const HEADERS = [
  "입금일",
  "발행일",
  "클라이언트",
  "채널",
  "청구액(원)",
  "원천징수유형",
  "원천징수액(원)",
  "실지급액(원)",
] as const;

const COLUMN_WIDTHS = [13, 13, 20, 14, 16, 14, 16, 16];

// 앱 UI와 같은 팔레트(slate/blue)로 맞춰 내려받은 파일도 같은 제품처럼 보이게 한다.
// 테두리는 엑셀 기본 눈금선과 구분되도록 한 단계 진한 회색을 쓴다.
const BORDER = "#94A3B8";
const TITLE_BG = "#EFF6FF";
const HEADER_BG = "#E2E8F0";
const TOTAL_BG = "#F1F5F9";
const MUTED_TEXT = "#64748B";
const MONEY_FORMAT = "#,##0";
const DATE_FORMAT = "yyyy-mm-dd";

// 행 높이(pt). 기본 15pt는 빽빽해 보여 제목·표 모두 여유를 준다.
const TITLE_HEIGHT = 34;
const META_HEIGHT = 20;
const ROW_HEIGHT = 24;

const CHANNEL_LABELS: Record<string, string> = {
  linkedin: "링크드인",
  instagram: "인스타그램",
  youtube: "유튜브",
  direct: "직거래",
  kmong: "크몽",
  referral: "추천",
  other: "기타",
};

const kstDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getReportChannelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? CHANNEL_LABELS.other;
}

/**
 * 세무 원장 시트(제목 → 생성 정보 → 표 머리글 → 내역 → 합계).
 * write-excel-file의 sheetData/columns 형태만 만드는 순수 함수라 서식까지 테스트할 수 있다.
 */
export function buildTaxLedgerSheet(
  rows: ReportLedgerRow[],
  options: { year: number; generatedAt: string },
): { sheetData: SheetRow[]; columns: SheetColumn[] } {
  const titleRow = spanningRow({
    value: `FreeSign 세무 원장 · ${options.year}년`,
    fontSize: 18,
    align: "center",
    alignVertical: "center",
    backgroundColor: TITLE_BG,
    borderColor: BORDER,
    borderStyle: "thin",
    height: TITLE_HEIGHT,
  });

  const metaRow = spanningRow({
    value: `입금일 기준 · 내보낸 날짜 ${toKstDateString(options.generatedAt)}`,
    textColor: MUTED_TEXT,
    align: "right",
    alignVertical: "center",
    height: META_HEIGHT,
  });

  const headerRow: SheetRow = HEADERS.map((label) => ({
    value: label,
    fontWeight: "bold",
    align: "center",
    alignVertical: "center",
    backgroundColor: HEADER_BG,
    borderColor: BORDER,
    borderStyle: "thin",
    height: ROW_HEIGHT,
  }));

  let totalAmount = 0;
  let totalWithholding = 0;
  let totalNet = 0;

  const bodyRows: SheetRow[] = rows.map((row) => {
    totalAmount += row.amount;
    totalWithholding += row.withholdingAmount;
    totalNet += row.netAmount;

    return [
      dateCell(toKstDate(row.paidAt)),
      dateCell(toKstDate(row.issueDate)),
      textCell(row.clientName),
      textCell(getReportChannelLabel(row.channel)),
      moneyCell(row.amount),
      textCell(getWithholdingTypeLabel(row.withholdingType)),
      moneyCell(row.withholdingAmount),
      moneyCell(row.netAmount),
    ];
  });

  const lastRow: SheetRow[] =
    rows.length === 0
      ? [
          spanningRow({
            value: "해당 연도에 입금 완료된 인보이스가 없습니다.",
            textColor: MUTED_TEXT,
            align: "center",
            alignVertical: "center",
            borderColor: BORDER,
            borderStyle: "thin",
            height: ROW_HEIGHT,
          }),
        ]
      : [
          [
            { ...textCell("합계"), fontWeight: "bold", backgroundColor: TOTAL_BG },
            emptyTotalCell(),
            emptyTotalCell(),
            emptyTotalCell(),
            { ...moneyCell(totalAmount), fontWeight: "bold", backgroundColor: TOTAL_BG },
            emptyTotalCell(),
            { ...moneyCell(totalWithholding), fontWeight: "bold", backgroundColor: TOTAL_BG },
            { ...moneyCell(totalNet), fontWeight: "bold", backgroundColor: TOTAL_BG },
          ],
        ];

  return {
    sheetData: [titleRow, metaRow, [], headerRow, ...bodyRows, ...lastRow],
    columns: COLUMN_WIDTHS.map((width) => ({ width })),
  };
}

/** 첫 칸이 표 너비 전체를 덮는 행. 나머지 칸은 병합 자리라 null이다. */
function spanningRow(cell: SheetCell): SheetRow {
  return [
    { ...cell, columnSpan: HEADERS.length },
    ...Array.from({ length: HEADERS.length - 1 }, () => null),
  ];
}

function textCell(value: string): SheetCell {
  return {
    value,
    type: String,
    align: "center",
    alignVertical: "center",
    borderColor: BORDER,
    borderStyle: "thin",
    height: ROW_HEIGHT,
  };
}

function moneyCell(value: number): SheetCell {
  return {
    value,
    type: Number,
    format: MONEY_FORMAT,
    align: "center",
    alignVertical: "center",
    borderColor: BORDER,
    borderStyle: "thin",
    height: ROW_HEIGHT,
  };
}

function dateCell(value: Date | undefined): SheetCell {
  return {
    value,
    type: Date,
    format: DATE_FORMAT,
    align: "center",
    alignVertical: "center",
    borderColor: BORDER,
    borderStyle: "thin",
    height: ROW_HEIGHT,
  };
}

function emptyTotalCell(): SheetCell {
  return {
    alignVertical: "center",
    backgroundColor: TOTAL_BG,
    borderColor: BORDER,
    borderStyle: "thin",
    height: ROW_HEIGHT,
  };
}

/**
 * KST 달력 날짜를 UTC 자정 Date로 만든다. Excel의 날짜는 시간대가 없으므로
 * UTC 기준으로 직렬화되는 값과 화면에 보일 날짜를 일치시킨다.
 */
function toKstDate(value: string): Date | undefined {
  const kst = toKstDateString(value);

  if (!kst) {
    return undefined;
  }

  const [year, month, day] = kst.split("-").map(Number);

  return new Date(Date.UTC(year!, month! - 1, day!));
}

function toKstDateString(value: string): string {
  if (!value) {
    return "";
  }

  // "2026-03-01" 같은 date 컬럼 값은 시간대 변환 없이 그대로 쓴다.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? "" : kstDateFormatter.format(parsed);
}

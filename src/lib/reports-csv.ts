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

const CSV_BOM = "﻿";
const CSV_HEADERS = [
  "입금일",
  "발행일",
  "클라이언트",
  "채널",
  "청구액(원)",
  "원천징수유형",
  "원천징수액(원)",
  "실지급액(원)"
] as const;

const CHANNEL_LABELS: Record<string, string> = {
  linkedin: "링크드인",
  instagram: "인스타그램",
  youtube: "유튜브",
  direct: "직거래",
  kmong: "크몽",
  referral: "추천",
  other: "기타"
};

const kstDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function getReportChannelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? CHANNEL_LABELS.other;
}

export function serializeTaxLedgerCsv(rows: ReportLedgerRow[]): string {
  let totalGross = 0;
  let totalWithholding = 0;
  let totalNet = 0;

  const bodyLines = rows.map((row) => {
    totalGross += row.amount;
    totalWithholding += row.withholdingAmount;
    totalNet += row.netAmount;

    return [
      formatKstDate(row.paidAt),
      row.issueDate,
      row.clientName,
      getReportChannelLabel(row.channel),
      String(row.amount),
      getWithholdingTypeLabel(row.withholdingType),
      String(row.withholdingAmount),
      String(row.netAmount)
    ]
      .map(escapeCsvField)
      .join(",");
  });

  const totalsLine = [
    "합계",
    "",
    "",
    "",
    String(totalGross),
    "",
    String(totalWithholding),
    String(totalNet)
  ]
    .map(escapeCsvField)
    .join(",");

  const lines = [
    CSV_HEADERS.map(escapeCsvField).join(","),
    ...bodyLines,
    totalsLine
  ];

  return `${CSV_BOM}${lines.join("\r\n")}`;
}

function formatKstDate(instant: string): string {
  const parts = kstDateFormatter.formatToParts(new Date(instant));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("failed to format KST date");
  }

  return `${year}-${month}-${day}`;
}

function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

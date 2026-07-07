import type { ChannelRevenueRow } from "@/lib/metrics";

export type ReportCsvRow = ChannelRevenueRow & {
  channelLabel: string;
};

const CSV_BOM = "\uFEFF";
const CSV_HEADERS = ["채널", "수익(원)"] as const;

const CHANNEL_LABELS: Record<string, string> = {
  linkedin: "링크드인",
  instagram: "인스타그램",
  youtube: "유튜브",
  direct: "직거래",
  kmong: "크몽",
  referral: "추천",
  other: "기타",
};

export function getReportChannelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? CHANNEL_LABELS.other;
}

export function serializeReportCsv(rows: ReportCsvRow[]): string {
  const lines = [
    CSV_HEADERS.map(escapeCsvField).join(","),
    ...rows.map((row) =>
      [row.channelLabel, String(row.revenue)].map(escapeCsvField).join(","),
    ),
  ];

  return `${CSV_BOM}${lines.join("\r\n")}`;
}

function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

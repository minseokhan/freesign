import type { Enums } from "@/types/database";

export type InvoicePaymentStatus = Enums<"payment_status">;
export type DueStatus = "overdue" | "due_soon" | "upcoming" | "paid";

export interface ChannelRevenueRow {
  channel: string;
  revenue: number;
}

const KST_TIME_ZONE = "Asia/Seoul";
const DUE_SOON_WINDOW_DAYS = 7;

const kstDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function formatKRW(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new Error("amount must be a safe integer");
  }

  const sign = amount < 0 ? "-" : "";
  const formattedAmount = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0
  }).format(Math.abs(amount));

  return `${sign}₩${formattedAmount}`;
}

export function deriveDueStatus(
  input: { dueDate: string; paymentStatus: InvoicePaymentStatus },
  now: Date
): DueStatus {
  if (input.paymentStatus === "paid") {
    return "paid";
  }

  if (input.paymentStatus === "draft") {
    return "upcoming";
  }

  const dueDay = dateOnlyToEpochDay(input.dueDate);
  const today = dateOnlyToEpochDay(formatKstDate(now));

  if (dueDay < today) {
    return "overdue";
  }

  // A one-week window matches the dashboard's "read in 3 seconds" near-due signal.
  if (dueDay <= today + DUE_SOON_WINDOW_DAYS) {
    return "due_soon";
  }

  return "upcoming";
}

export function topChannelsByRevenue(
  rows: ChannelRevenueRow[],
  limit: number
): ChannelRevenueRow[] {
  const normalizedLimit = Math.max(0, Math.trunc(limit));

  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const revenueOrder = right.row.revenue - left.row.revenue;
      return revenueOrder === 0 ? left.index - right.index : revenueOrder;
    })
    .slice(0, normalizedLimit)
    .map(({ row }) => row);
}

function formatKstDate(date: Date): string {
  const parts = kstDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("failed to format KST date");
  }

  return `${year}-${month}-${day}`;
}

function dateOnlyToEpochDay(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    throw new Error("date must use YYYY-MM-DD format");
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error("date must be a valid calendar date");
  }

  return daysFromCivil(year, month, day);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const monthOfYear = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * monthOfYear + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;

  return era * 146_097 + dayOfEra - 719_468;
}

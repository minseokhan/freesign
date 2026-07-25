// 반복 인보이스 다음 생성일 계산(순수 함수). Postgres의 date + interval 산술과 등가로 맞춘다:
//  - weekly: 7일 더하기
//  - monthly: 한 달 더하기 + 월말 클램프(예: 1/31 → 2/28, 윤년 2/29)
// 월말 클램프는 Postgres `date '2026-01-31' + interval '1 month' = '2026-02-28'`과 동일.
export type RecurringInterval = "weekly" | "monthly";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function computeNextRun(
  current: string,
  interval: RecurringInterval,
): string {
  const match = DATE_RE.exec(current);
  if (!match) {
    throw new Error("date must use YYYY-MM-DD format");
  }

  let year = Number(match[1]);
  let month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error("date must be a valid calendar date");
  }

  if (interval === "weekly") {
    const epoch = Date.UTC(year, month - 1, day) + 7 * 24 * 60 * 60 * 1000;
    const next = new Date(epoch);
    return format(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
    );
  }

  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  const clampedDay = Math.min(day, daysInMonth(year, month));
  return format(year, month, clampedDay);
}

function format(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
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

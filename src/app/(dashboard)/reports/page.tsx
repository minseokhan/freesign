import Link from "next/link";

import { ChannelBadge } from "@/components/channel-badge";
import { Card } from "@/components/ui/card";
import {
  formatKRW,
  topChannelsByRevenue,
  type ChannelRevenueRow,
} from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";

type ReportsPageProps = {
  searchParams?: Promise<{
    year?: string;
  }>;
};

type ReportChannelRevenue = {
  channel: string;
  revenue: number | string | null;
  total_revenue: number | string | null;
};

type ReportRpcClient = {
  rpc(
    functionName: "get_report_channel_revenue",
    args: { report_year: number },
  ): PromiseLike<{ data: ReportChannelRevenue[] | null; error: Error | null }>;
};

const YEAR_RANGE = 5;

function getCurrentKstYear() {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
    }).format(new Date()),
  );
}

function parseYear(value: string | undefined, fallbackYear: number) {
  if (!value) {
    return fallbackYear;
  }

  const year = Number(value);

  return Number.isInteger(year) && year >= 2000 && year <= 2100
    ? year
    : fallbackYear;
}

function toAmount(value: number | string | null | undefined) {
  if (value == null) {
    return 0;
  }

  return typeof value === "number" ? value : Number(value);
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const resolvedSearchParams = await searchParams;
  const currentYear = getCurrentKstYear();
  const selectedYear = parseYear(resolvedSearchParams?.year, currentYear);
  const yearOptions = Array.from(
    { length: YEAR_RANGE },
    (_, index) => currentYear - index,
  );
  const supabase = await createClient();
  const rpc = supabase as unknown as ReportRpcClient;
  const { data, error } = await rpc.rpc("get_report_channel_revenue", {
    report_year: selectedYear,
  });

  if (error) {
    throw error;
  }

  const rows: ChannelRevenueRow[] = (data ?? []).map((row) => ({
    channel: row.channel,
    revenue: toAmount(row.revenue),
  }));
  const reportRows = topChannelsByRevenue(rows, rows.length);
  const totalRevenue = toAmount(data?.[0]?.total_revenue);
  const csvHref = `/api/reports?year=${selectedYear}`;

  return (
    <div className="space-y-xl">
      <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
            리포트
          </h2>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            {selectedYear}년 입금 기준으로 채널별 실지급 수익을 확인합니다.
          </p>
        </div>
        <Link
          href={csvHref}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          CSV 내보내기
        </Link>
      </div>

      <nav aria-label="리포트 연도 필터" className="flex flex-wrap gap-sm">
        {yearOptions.map((year) => {
          const isActive = year === selectedYear;

          return (
            <Link
              key={year}
              href={`/reports?year=${year}`}
              className={[
                "inline-flex min-h-11 items-center rounded-full border px-lg py-sm text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
                isActive
                  ? "border-blue-200 bg-brand-point text-brand-primary"
                  : "border-surface-border bg-white text-text-body hover:bg-surface-muted",
              ].join(" ")}
              aria-current={isActive ? "page" : undefined}
            >
              {year}
            </Link>
          );
        })}
      </nav>

      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
          연간 입금 수익
        </p>
        <p className="mt-md text-3xl font-bold tracking-tight text-green-700 tabular-nums">
          {formatKRW(totalRevenue)}
        </p>
        <p className="mt-sm text-xs leading-relaxed text-text-muted">
          payment_status가 입금 완료이고 paid_at의 KST 연도가 {selectedYear}년인
          인보이스의 실지급액 합계입니다.
        </p>
      </Card>

      {reportRows.length === 0 ? (
        <Card className="flex min-h-80 flex-col items-center justify-center gap-lg text-center">
          <div aria-hidden="true" className="text-3xl font-semibold text-blue-600">
            FS
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">
              해당 연도 입금 기록이 없어요
            </h3>
            <p className="mt-sm max-w-md text-sm leading-relaxed text-text-muted">
              입금 완료된 인보이스가 생기면 채널별 수익과 CSV 내보내기를 사용할
              수 있습니다.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-surface-border px-xl py-lg">
            <h3 className="text-lg font-semibold text-text-primary">
              채널별 수익
            </h3>
            <p className="mt-xs text-sm text-text-muted">
              입금 기준 KST 연도별 실지급액이며, 발행일 기준이 아닙니다.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-text-muted">
                <tr>
                  <th scope="col" className="px-xl py-md">
                    채널
                  </th>
                  <th scope="col" className="px-xl py-md text-right">
                    수익
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {reportRows.map((row) => (
                  <tr
                    key={row.channel}
                    className="transition-colors hover:bg-surface-muted"
                  >
                    <td className="px-xl py-lg">
                      <ChannelBadge channel={row.channel} />
                    </td>
                    <td className="px-xl py-lg text-right font-medium tabular-nums text-text-primary">
                      {formatKRW(row.revenue)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface-muted">
                  <th scope="row" className="px-xl py-lg text-text-primary">
                    합계
                  </th>
                  <td className="px-xl py-lg text-right font-semibold tabular-nums text-text-primary">
                    {formatKRW(totalRevenue)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

import Link from "next/link";

import { UpgradeButton, UpgradeCard } from "@/components/billing/upgrade-cta";
import { ChannelBadge } from "@/components/channel-badge";
import { Logo } from "@/components/logo";
import { Card } from "@/components/ui/card";
import {
  formatKRW,
  getWithholdingTypeLabel,
  sumTaxSummary,
  topChannelsByRevenue,
  topClientsByRevenue,
  type ChannelRevenueRow,
  type ClientRevenueRow,
  type OutstandingSummary,
  type TaxSummaryRow,
} from "@/lib/metrics";
import {
  summarizeInsights,
  type InsightRow,
  type InsightSummary,
} from "@/lib/insights";
import { getUserPlan } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";

type ReportsPageProps = {
  searchParams?: Promise<{
    year?: string;
  }>;
};

type Amount = number | string | null;

type ChannelRevenueRpcRow = {
  channel: string;
  revenue: Amount;
  total_revenue: Amount;
};

type TaxSummaryRpcRow = {
  withholding_type: string;
  invoice_count: Amount;
  gross_amount: Amount;
  withholding_amount: Amount;
  net_amount: Amount;
};

type ClientRevenueRpcRow = {
  client_id: string;
  client_name: string;
  revenue: Amount;
  total_revenue: Amount;
};

type OutstandingRpcRow = {
  unpaid_count: Amount;
  unpaid_amount: Amount;
  overdue_count: Amount;
  overdue_amount: Amount;
};

type RpcResult<T> = PromiseLike<{ data: T | null; error: Error | null }>;

type ReportRpcClient = {
  rpc(
    functionName: "get_report_channel_revenue",
    args: { report_year: number },
  ): RpcResult<ChannelRevenueRpcRow[]>;
  rpc(
    functionName: "get_report_tax_summary",
    args: { report_year: number },
  ): RpcResult<TaxSummaryRpcRow[]>;
  rpc(
    functionName: "get_report_client_revenue",
    args: { report_year: number },
  ): RpcResult<ClientRevenueRpcRow[]>;
  rpc(
    functionName: "get_report_outstanding",
    args: { report_year: number },
  ): RpcResult<OutstandingRpcRow[]>;
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

function toAmount(value: Amount | undefined) {
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

  const [channelResult, taxResult, clientResult, outstandingResult, plan] =
    await Promise.all([
      rpc.rpc("get_report_channel_revenue", { report_year: selectedYear }),
      rpc.rpc("get_report_tax_summary", { report_year: selectedYear }),
      rpc.rpc("get_report_client_revenue", { report_year: selectedYear }),
      rpc.rpc("get_report_outstanding", { report_year: selectedYear }),
      getUserPlan(),
    ]);

  const isPro = plan === "pro";

  const firstError =
    channelResult.error ??
    taxResult.error ??
    clientResult.error ??
    outstandingResult.error;

  if (firstError) {
    throw firstError;
  }

  const channelRows: ChannelRevenueRow[] = (channelResult.data ?? []).map(
    (row) => ({ channel: row.channel, revenue: toAmount(row.revenue) }),
  );
  const reportRows = topChannelsByRevenue(channelRows, channelRows.length);
  const totalRevenue = toAmount(channelResult.data?.[0]?.total_revenue);

  const taxRows: TaxSummaryRow[] = (taxResult.data ?? []).map((row) => ({
    withholdingType: row.withholding_type,
    invoiceCount: toAmount(row.invoice_count),
    grossAmount: toAmount(row.gross_amount),
    withholdingAmount: toAmount(row.withholding_amount),
    netAmount: toAmount(row.net_amount),
  }));
  const taxTotals = sumTaxSummary(taxRows);

  const clientRows: ClientRevenueRow[] = (clientResult.data ?? []).map(
    (row) => ({
      clientId: row.client_id,
      clientName: row.client_name,
      revenue: toAmount(row.revenue),
    }),
  );
  const clientReportRows = topClientsByRevenue(clientRows, clientRows.length);

  const outstandingRow = outstandingResult.data?.[0];
  const outstanding: OutstandingSummary = {
    unpaidCount: toAmount(outstandingRow?.unpaid_count),
    unpaidAmount: toAmount(outstandingRow?.unpaid_amount),
    overdueCount: toAmount(outstandingRow?.overdue_count),
    overdueAmount: toAmount(outstandingRow?.overdue_amount),
  };

  const exportHref = `/api/reports?year=${selectedYear}`;
  const hasPaidData = reportRows.length > 0;

  // 종합 계약 피드백 요약(Pro). 저장된 인사이트를 위험도 분포 + 공통 findings로 집계한다.
  let insightSummary: InsightSummary | null = null;
  if (isPro) {
    const { data: insightRows } = await supabase
      .from("contract_insights")
      .select("risk_level,findings")
      .order("created_at", { ascending: false })
      .limit(100);
    insightSummary = summarizeInsights(
      (insightRows ?? []) as unknown as InsightRow[],
      5,
    );
  }

  function formatShare(revenue: number) {
    if (totalRevenue <= 0) {
      return 0;
    }

    return (revenue / totalRevenue) * 100;
  }

  return (
    <div className="space-y-xl">
      <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
            리포트
          </h2>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            {selectedYear}년 입금 기준 연 결산과 종합소득세 정리에 필요한 내역을
            확인합니다.
          </p>
        </div>
        {isPro ? (
          <Link
            href={exportHref}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
          >
            Excel 내보내기
          </Link>
        ) : (
          <UpgradeButton>Excel 내보내기 (Pro)</UpgradeButton>
        )}
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

      <div className="grid gap-lg sm:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            연간 입금 수익
          </p>
          <p className="mt-md text-3xl font-bold tracking-tight text-green-700 tabular-nums">
            {formatKRW(totalRevenue)}
          </p>
          <p className="mt-sm text-xs leading-relaxed text-text-muted">
            입금 완료된 인보이스의 실지급액(원천징수 후) 합계입니다.
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            총 원천징수
          </p>
          <p className="mt-md text-3xl font-bold tracking-tight text-text-primary tabular-nums">
            {formatKRW(taxTotals.withholdingAmount)}
          </p>
          <p className="mt-sm text-xs leading-relaxed text-text-muted">
            총 청구액 {formatKRW(taxTotals.grossAmount)} 중 원천징수 합계입니다.
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            미수 · 연체
          </p>
          <p className="mt-md text-3xl font-bold tracking-tight text-text-primary tabular-nums">
            {formatKRW(outstanding.unpaidAmount)}
          </p>
          <p className="mt-sm text-xs leading-relaxed text-text-muted">
            {selectedYear}년 발행분 미수 {outstanding.unpaidCount}건 · 연체{" "}
            {outstanding.overdueCount}건({formatKRW(outstanding.overdueAmount)}).
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-surface-border pb-md">
          <h3 className="text-lg font-semibold text-text-primary">
            연간 세무 요약
          </h3>
          <p className="mt-xs text-sm text-text-muted">
            입금 기준 원천징수 유형별 청구액·원천징수액·실지급액입니다. 종합소득세
            정리 참고용입니다.
          </p>
        </div>
        {taxRows.length === 0 ? (
          <p className="py-xl text-sm text-text-muted">
            해당 연도 입금 내역이 없어 표시할 세무 요약이 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-text-muted">
                <tr>
                  <th scope="col" className="px-lg py-md">
                    원천징수 유형
                  </th>
                  <th scope="col" className="px-lg py-md text-right">
                    건수
                  </th>
                  <th scope="col" className="px-lg py-md text-right">
                    청구액
                  </th>
                  <th scope="col" className="px-lg py-md text-right">
                    원천징수액
                  </th>
                  <th scope="col" className="px-lg py-md text-right">
                    실지급액
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {taxRows.map((row) => (
                  <tr
                    key={row.withholdingType}
                    className="transition-colors hover:bg-surface-muted"
                  >
                    <td className="px-lg py-lg text-text-primary">
                      {getWithholdingTypeLabel(row.withholdingType)}
                    </td>
                    <td className="px-lg py-lg text-right tabular-nums text-text-muted">
                      {row.invoiceCount}건
                    </td>
                    <td className="px-lg py-lg text-right tabular-nums text-text-primary">
                      {formatKRW(row.grossAmount)}
                    </td>
                    <td className="px-lg py-lg text-right tabular-nums text-text-primary">
                      {formatKRW(row.withholdingAmount)}
                    </td>
                    <td className="px-lg py-lg text-right font-medium tabular-nums text-text-primary">
                      {formatKRW(row.netAmount)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface-muted">
                  <th scope="row" className="px-lg py-lg text-text-primary">
                    합계
                  </th>
                  <td className="px-lg py-lg text-right tabular-nums text-text-muted">
                    {taxTotals.invoiceCount}건
                  </td>
                  <td className="px-lg py-lg text-right font-semibold tabular-nums text-text-primary">
                    {formatKRW(taxTotals.grossAmount)}
                  </td>
                  <td className="px-lg py-lg text-right font-semibold tabular-nums text-text-primary">
                    {formatKRW(taxTotals.withholdingAmount)}
                  </td>
                  <td className="px-lg py-lg text-right font-semibold tabular-nums text-text-primary">
                    {formatKRW(taxTotals.netAmount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="text-lg font-semibold text-text-primary">
          미수/연체 결산
        </h3>
        <p className="mt-xs text-sm text-text-muted">
          {selectedYear}년 발행분 중 아직 입금되지 않은 청구액입니다. 연체는
          지급기한(KST)이 지난 건입니다.
        </p>
        {outstanding.unpaidCount === 0 ? (
          <p className="mt-lg text-sm text-text-muted">
            해당 연도 발행분 중 미수 건이 없습니다.
          </p>
        ) : (
          <div className="mt-lg grid gap-lg sm:grid-cols-2">
            <div className="rounded-md border border-surface-border px-lg py-md">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                미수
              </p>
              <p className="mt-sm text-2xl font-bold tabular-nums text-text-primary">
                {formatKRW(outstanding.unpaidAmount)}
              </p>
              <p className="mt-xs text-xs text-text-muted">
                {outstanding.unpaidCount}건
              </p>
            </div>
            <div className="rounded-md border border-surface-border px-lg py-md">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                연체
              </p>
              <p className="mt-sm text-2xl font-bold tabular-nums text-red-700">
                {formatKRW(outstanding.overdueAmount)}
              </p>
              <p className="mt-xs text-xs text-text-muted">
                {outstanding.overdueCount}건
              </p>
            </div>
          </div>
        )}
      </Card>

      {hasPaidData && !isPro ? (
        <UpgradeCard
          title="채널·클라이언트별 수익 랭킹"
          description="어떤 채널과 거래처가 가장 많이 벌어주는지 보여주는 상세 랭킹은 Pro 전용이에요. 세금 요약은 무료로 계속 볼 수 있어요."
        />
      ) : hasPaidData ? (
        <div className="grid gap-xl lg:grid-cols-2">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-surface-border pb-md">
              <h3 className="text-lg font-semibold text-text-primary">
                채널별 수익
              </h3>
              <p className="mt-xs text-sm text-text-muted">
                입금 기준 KST 연도별 실지급액이며, 발행일 기준이 아닙니다.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] border-collapse text-left text-sm">
                <thead className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-text-muted">
                  <tr>
                    <th scope="col" className="px-lg py-md">
                      채널
                    </th>
                    <th scope="col" className="px-lg py-md">
                      비중
                    </th>
                    <th scope="col" className="px-lg py-md text-right">
                      수익
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {reportRows.map((row) => {
                    const share = formatShare(row.revenue);

                    return (
                      <tr
                        key={row.channel}
                        className="transition-colors hover:bg-surface-muted"
                      >
                        <td className="px-lg py-lg">
                          <ChannelBadge channel={row.channel} />
                        </td>
                        <td className="px-lg py-lg">
                          <div className="flex items-center gap-md">
                            <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-muted">
                              <div
                                className="h-full rounded-full bg-brand-primary"
                                style={{ width: `${share}%` }}
                              />
                            </div>
                            <span className="tabular-nums text-text-muted">
                              {share.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-lg py-lg text-right font-medium tabular-nums text-text-primary">
                          {formatKRW(row.revenue)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-surface-muted">
                    <th scope="row" className="px-lg py-lg text-text-primary">
                      합계
                    </th>
                    <td className="px-lg py-lg tabular-nums text-text-muted">
                      100.0%
                    </td>
                    <td className="px-lg py-lg text-right font-semibold tabular-nums text-text-primary">
                      {formatKRW(totalRevenue)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-surface-border pb-md">
              <h3 className="text-lg font-semibold text-text-primary">
                클라이언트별 수익
              </h3>
              <p className="mt-xs text-sm text-text-muted">
                입금 기준 실지급액을 고객별로 집계했습니다.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] border-collapse text-left text-sm">
                <thead className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-text-muted">
                  <tr>
                    <th scope="col" className="px-lg py-md">
                      클라이언트
                    </th>
                    <th scope="col" className="px-lg py-md">
                      비중
                    </th>
                    <th scope="col" className="px-lg py-md text-right">
                      수익
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {clientReportRows.map((row) => {
                    const share = formatShare(row.revenue);

                    return (
                      <tr
                        key={row.clientId}
                        className="transition-colors hover:bg-surface-muted"
                      >
                        <td className="px-lg py-lg font-medium text-text-primary">
                          {row.clientName}
                        </td>
                        <td className="px-lg py-lg">
                          <div className="flex items-center gap-md">
                            <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-muted">
                              <div
                                className="h-full rounded-full bg-brand-primary"
                                style={{ width: `${share}%` }}
                              />
                            </div>
                            <span className="tabular-nums text-text-muted">
                              {share.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-lg py-lg text-right font-medium tabular-nums text-text-primary">
                          {formatKRW(row.revenue)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-surface-muted">
                    <th scope="row" className="px-lg py-lg text-text-primary">
                      합계
                    </th>
                    <td className="px-lg py-lg tabular-nums text-text-muted">
                      100.0%
                    </td>
                    <td className="px-lg py-lg text-right font-semibold tabular-nums text-text-primary">
                      {formatKRW(totalRevenue)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : (
        <Card className="flex min-h-80 flex-col items-center justify-center gap-lg text-center">
          <div aria-hidden="true">
            <Logo className="h-8" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">
              해당 연도 입금 기록이 없어요
            </h3>
            <p className="mt-sm max-w-md text-sm leading-relaxed text-text-muted">
              입금 완료된 인보이스가 생기면 채널·클라이언트별 수익과 Excel
              내보내기를 사용할 수 있습니다.
            </p>
          </div>
        </Card>
      )}

      {!isPro ? (
        <UpgradeCard
          title="종합 계약 피드백 요약"
          description="AI가 분석한 과거 계약의 위험도 분포와 자주 지적된 조항을 한눈에 모아 봐요. Pro 전용이에요."
        />
      ) : insightSummary && insightSummary.total > 0 ? (
        <Card>
          <div className="border-b border-surface-border pb-lg">
            <h3 className="text-lg font-semibold text-text-primary">
              종합 계약 피드백 요약
            </h3>
            <p className="mt-xs text-sm text-text-muted">
              저장된 계약 인사이트 {insightSummary.total}건을 집계했습니다. 참고용이며 법적 자문이 아닙니다.
            </p>
          </div>
          <div className="mt-xl grid gap-lg sm:grid-cols-3">
            <div className="rounded-md border border-surface-border px-lg py-md">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">위험 낮음</p>
              <p className="mt-sm text-2xl font-bold tabular-nums text-green-700">{insightSummary.riskCounts.low}</p>
            </div>
            <div className="rounded-md border border-surface-border px-lg py-md">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">위험 보통</p>
              <p className="mt-sm text-2xl font-bold tabular-nums text-amber-700">{insightSummary.riskCounts.medium}</p>
            </div>
            <div className="rounded-md border border-surface-border px-lg py-md">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">위험 높음</p>
              <p className="mt-sm text-2xl font-bold tabular-nums text-red-700">{insightSummary.riskCounts.high}</p>
            </div>
          </div>
          {insightSummary.topFindings.length > 0 ? (
            <div className="mt-xl">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                자주 지적된 조항
              </p>
              <ul className="mt-md space-y-sm">
                {insightSummary.topFindings.map((finding) => (
                  <li key={finding.clauseTitle} className="flex items-center justify-between gap-sm text-sm">
                    <span className="text-text-body">{finding.clauseTitle}</span>
                    <span className="tabular-nums text-text-muted">{finding.count}건</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

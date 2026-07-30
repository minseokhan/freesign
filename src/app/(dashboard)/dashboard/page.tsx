import { Fragment } from "react";

import Link from "next/link";

import { UpgradeCard } from "@/components/billing/upgrade-cta";
import { ChannelBadge } from "@/components/channel-badge";
import { DemoDataButton } from "@/components/demo-data-button";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { notDeleted } from "@/lib/db";
import {
  deriveDueStatus,
  formatKRW,
  summarizeContractPipeline,
  topChannelsByRevenue,
  type ChannelRevenueRow,
  type DueStatus,
} from "@/lib/metrics";
import { getUserPlan } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type DashboardTotals = {
  outstanding_amount: number | string | null;
  outstanding_count: number | string | null;
  monthly_revenue: number | string | null;
  monthly_paid_count: number | string | null;
  expected_this_month_amount: number | string | null;
  expected_this_month_count: number | string | null;
};

type DashboardChannelRevenue = {
  channel: string;
  revenue: number | string | null;
};

type DashboardContractPipeline = {
  status: string;
  count: number | string | null;
};

type DashboardRpcClient = {
  rpc(
    functionName: "get_dashboard_totals",
  ): PromiseLike<{ data: DashboardTotals[] | null; error: Error | null }>;
  rpc(
    functionName: "get_dashboard_channel_revenue",
  ): PromiseLike<{ data: DashboardChannelRevenue[] | null; error: Error | null }>;
  rpc(
    functionName: "get_dashboard_contract_pipeline",
  ): PromiseLike<{ data: DashboardContractPipeline[] | null; error: Error | null }>;
};

type InvoiceRow = Pick<
  Database["public"]["Tables"]["invoices"]["Row"],
  "id" | "amount" | "due_date" | "payment_status"
> & {
  client: {
    name: string;
  } | null;
  contract: {
    title: string;
  } | null;
};

type AttentionInvoice = InvoiceRow & {
  dueStatus: Extract<DueStatus, "overdue" | "due_soon">;
};

// 파이프라인 단계는 진행감이 보이도록 회색→파랑→앰버→초록으로 구분한다
// (계약 상태 배지는 signed/active가 모두 앰버라 인접 단계가 겹쳐 별도 팔레트를 쓴다).
const PIPELINE_STAGE_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-500",
  signed: "bg-blue-50 text-blue-500",
  active: "bg-amber-50 text-amber-600",
  done: "bg-green-50 text-green-600",
};

function toAmount(value: number | string | null | undefined) {
  if (value == null) {
    return 0;
  }

  return typeof value === "number" ? value : Number(value);
}

function formatDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);

  if (!match) {
    return date;
  }

  const [, year, month, day] = match;

  return `${year}.${month}.${day}`;
}

function DueStatusBadge({ status }: { status: AttentionInvoice["dueStatus"] }) {
  if (status === "overdue") {
    return <Badge variant="danger">지연</Badge>;
  }

  return <Badge variant="warning">임박</Badge>;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const rpc = supabase as unknown as DashboardRpcClient;

  const [
    totalsResult,
    channelRevenueResult,
    contractPipelineResult,
    unpaidInvoicesResult,
    demoClientResult,
    plan,
  ] = await Promise.all([
    rpc.rpc("get_dashboard_totals"),
    rpc.rpc("get_dashboard_channel_revenue"),
    rpc.rpc("get_dashboard_contract_pipeline"),
    notDeleted(
      supabase
        .from("invoices")
        .select("id,amount,due_date,payment_status,client:clients(name),contract:contracts(title)")
        .eq("payment_status", "unpaid"),
    )
      .order("due_date", { ascending: true })
      .limit(12),
    supabase
      .from("clients")
      .select("id")
      .eq("is_demo", true)
      .limit(1)
      .maybeSingle(),
    getUserPlan(),
  ]);

  if (totalsResult.error) {
    throw totalsResult.error;
  }

  if (channelRevenueResult.error) {
    throw channelRevenueResult.error;
  }

  if (contractPipelineResult.error) {
    throw contractPipelineResult.error;
  }

  if (unpaidInvoicesResult.error) {
    throw unpaidInvoicesResult.error;
  }

  if (demoClientResult.error) {
    throw demoClientResult.error;
  }

  const totals = totalsResult.data?.[0];
  const outstandingAmount = toAmount(totals?.outstanding_amount);
  const outstandingCount = toAmount(totals?.outstanding_count);
  const monthlyRevenue = toAmount(totals?.monthly_revenue);
  const monthlyPaidCount = toAmount(totals?.monthly_paid_count);
  const expectedThisMonthAmount = toAmount(totals?.expected_this_month_amount);
  const expectedThisMonthCount = toAmount(totals?.expected_this_month_count);
  const contractPipeline = summarizeContractPipeline(
    (contractPipelineResult.data ?? []).map((row) => ({
      status: row.status,
      count: toAmount(row.count),
    })),
  );
  const channelRevenueRows: ChannelRevenueRow[] = (
    channelRevenueResult.data ?? []
  ).map((row) => ({
    channel: row.channel,
    revenue: toAmount(row.revenue),
  }));
  const topChannels = topChannelsByRevenue(channelRevenueRows, 5);
  const now = new Date();
  const attentionInvoices = ((unpaidInvoicesResult.data ?? []) as InvoiceRow[])
    .map((invoice) => ({
      ...invoice,
      dueStatus: deriveDueStatus(
        {
          dueDate: invoice.due_date,
          paymentStatus: invoice.payment_status,
        },
        now,
      ),
    }))
    .filter(
      (invoice): invoice is AttentionInvoice =>
        invoice.dueStatus === "overdue" || invoice.dueStatus === "due_soon",
    );
  const hasDashboardData =
    outstandingAmount > 0 || monthlyRevenue > 0 || channelRevenueRows.length > 0;
  const hasDemoData = demoClientResult.data !== null;

  if (!hasDashboardData) {
    return (
      <Card className="flex min-h-80 flex-col items-center justify-center gap-lg text-center">
        <div aria-hidden="true">
          <Logo className="h-8" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            아직 대시보드 데이터가 없어요
          </h2>
          <p className="mt-sm max-w-md text-sm leading-relaxed text-text-muted">
            계약과 인보이스가 연결되면 미수금, 이달 수익, 임박한 지급기한을
            한 화면에서 확인할 수 있습니다.
          </p>
        </div>
        <DemoDataButton hasDemoData={hasDemoData} />
      </Card>
    );
  }

  return (
    <div className="space-y-xl">
      <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
            대시보드
          </h2>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            미수금, 입금 수익, 지급기한을 정산 흐름 기준으로 확인합니다.
          </p>
        </div>
        <DemoDataButton hasDemoData={hasDemoData} />
      </div>

      <section
        aria-label="핵심 정산 지표"
        className="grid grid-cols-1 gap-lg md:grid-cols-3"
      >
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            미수금 합계
          </p>
          <p className="mt-md text-3xl font-bold tracking-tight text-red-700 tabular-nums">
            {formatKRW(outstandingAmount)}
          </p>
          <p className="mt-sm text-xs leading-relaxed text-text-muted">
            미입금 인보이스 {outstandingCount}건의 청구 총액입니다.
          </p>
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            이달 수익
          </p>
          <p className="mt-md text-3xl font-bold tracking-tight text-green-700 tabular-nums">
            {formatKRW(monthlyRevenue)}
          </p>
          <p className="mt-sm text-xs leading-relaxed text-text-muted">
            KST 입금월 기준 입금 {monthlyPaidCount}건의 실지급액 합계입니다.
          </p>
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            이번 달 예정 입금
          </p>
          <p className="mt-md text-3xl font-bold tracking-tight text-amber-700 tabular-nums">
            {formatKRW(expectedThisMonthAmount)}
          </p>
          <p className="mt-sm text-xs leading-relaxed text-text-muted">
            이번 달 지급기한이 도래하는 미입금 {expectedThisMonthCount}건의 청구액입니다.
          </p>
        </Card>
      </section>

      <section aria-label="계약 파이프라인">
        <Card>
          <div className="flex flex-col gap-xs sm:flex-row sm:items-baseline sm:justify-between">
            <h3 className="text-lg font-semibold text-text-primary">
              계약 파이프라인
            </h3>
            <p className="text-sm text-text-muted">
              취소를 제외한 계약의 진행 단계별 건수입니다.
            </p>
          </div>
          <div className="mt-lg flex flex-col gap-sm sm:flex-row sm:items-center">
            {contractPipeline.map((stage, index) => {
              const stageStyle =
                PIPELINE_STAGE_STYLES[stage.status] ??
                PIPELINE_STAGE_STYLES.draft;
              const isEmpty = stage.count === 0;

              return (
                <Fragment key={stage.status}>
                  <div
                    className={cn(
                      "flex flex-1 items-center justify-between gap-md rounded-md px-lg py-md sm:flex-col sm:items-start sm:gap-sm",
                      stageStyle,
                      isEmpty && "opacity-60",
                    )}
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide">
                      {stage.label}
                    </span>
                    <span className="text-3xl font-bold tabular-nums">
                      {stage.count}
                    </span>
                  </div>
                  {index < contractPipeline.length - 1 ? (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mx-auto h-5 w-5 shrink-0 rotate-90 text-text-disabled sm:rotate-0"
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-lg xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        {/* twMerge가 커스텀 여백 토큰(p-xl)을 인식하지 못해 p-0이 기본 패딩을 지우지 못한다. !important로 강제해 헤더/테이블을 full-bleed로 정렬한다. */}
        <Card className="!p-0">
          <div className="px-xl py-xl">
            <h3 className="text-lg font-semibold text-text-primary">
              임박/지연 지급기한
            </h3>
            <p className="mt-xs text-sm text-text-muted">
              미입금 인보이스 중 오늘 기준 지연 또는 7일 이내 항목입니다.
            </p>
          </div>

          {attentionInvoices.length === 0 ? (
            <div className="px-xl pb-xl">
              {/* 바로 위 설명문과 같은 크기·색이면 빈 상태인지 설명인지 구분되지 않아,
                  점선 박스 + 체크 아이콘으로 "지금은 비어 있다"를 형태로 드러낸다. */}
              <div className="flex items-center gap-md rounded-md border border-dashed border-surface-border bg-surface-muted px-lg py-xl">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-status-paid-bg text-green-700">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="size-4"
                    aria-hidden="true"
                  >
                    <path
                      d="m5 12.5 4.5 4.5L19 7.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <p className="text-sm font-medium text-text-body">
                  챙길 지급기한이 없습니다.
                  <span className="ml-xs font-normal text-text-muted">
                    지연되거나 7일 안에 도래하는 인보이스가 아직 없어요.
                  </span>
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto px-md pb-md">
              <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                <thead className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-text-muted">
                  <tr>
                    <th scope="col" className="whitespace-nowrap px-md py-md">
                      클라이언트
                    </th>
                    <th scope="col" className="whitespace-nowrap px-md py-md">
                      계약
                    </th>
                    <th scope="col" className="whitespace-nowrap px-md py-md text-right">
                      금액
                    </th>
                    <th scope="col" className="whitespace-nowrap px-md py-md">
                      지급기한
                    </th>
                    <th scope="col" className="whitespace-nowrap px-md py-md">
                      상태
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {attentionInvoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="transition-colors hover:bg-surface-muted"
                    >
                      <td className="px-md py-lg text-text-body">
                        {invoice.client?.name ?? "클라이언트 없음"}
                      </td>
                      <td className="px-md py-lg">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="font-medium text-text-primary hover:text-brand-primary"
                        >
                          {invoice.contract?.title ?? "계약 없음"}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-md py-lg text-right font-medium tabular-nums text-text-primary">
                        {formatKRW(invoice.amount)}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-md py-lg font-medium tabular-nums",
                          invoice.dueStatus === "overdue"
                            ? "text-red-700"
                            : "text-amber-700",
                        )}
                      >
                        {formatDate(invoice.due_date)}
                      </td>
                      <td className="whitespace-nowrap px-md py-lg">
                        <DueStatusBadge status={invoice.dueStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {plan === "free" ? (
          <UpgradeCard
            title="채널 수익 TOP"
            description="채널별 매출 랭킹은 Pro 전용이에요. 업그레이드하면 어떤 채널이 가장 많이 벌어주는지 한눈에 볼 수 있어요."
          />
        ) : (
        <Card>
          <h3 className="text-lg font-semibold text-text-primary">
            채널 수익 TOP
          </h3>
          <p className="mt-xs text-sm text-text-muted">
            입금 완료 인보이스의 실지급액 기준입니다.
          </p>

          {topChannels.length === 0 ? (
            <p className="mt-xl text-sm text-text-muted">
              아직 입금 완료된 인보이스가 없습니다.
            </p>
          ) : (
            <ol className="mt-xl space-y-lg">
              {topChannels.map((row, index) => (
                <li
                  key={row.channel}
                  className="flex items-center justify-between gap-lg"
                >
                  <div className="flex min-w-0 items-center gap-sm">
                    <span className="w-5 text-sm font-medium tabular-nums text-text-muted">
                      {index + 1}
                    </span>
                    <ChannelBadge channel={row.channel} />
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
                    {formatKRW(row.revenue)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        )}
      </section>
    </div>
  );
}

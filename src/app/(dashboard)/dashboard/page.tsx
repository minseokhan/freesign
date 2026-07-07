import Link from "next/link";

import { ChannelBadge } from "@/components/channel-badge";
import { DemoDataButton } from "@/components/demo-data-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { notDeleted } from "@/lib/db";
import {
  deriveDueStatus,
  formatKRW,
  topChannelsByRevenue,
  type ChannelRevenueRow,
  type DueStatus,
} from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type DashboardTotals = {
  outstanding_amount: number | string | null;
  monthly_revenue: number | string | null;
};

type DashboardChannelRevenue = {
  channel: string;
  revenue: number | string | null;
};

type DashboardRpcClient = {
  rpc(
    functionName: "get_dashboard_totals",
  ): PromiseLike<{ data: DashboardTotals[] | null; error: Error | null }>;
  rpc(
    functionName: "get_dashboard_channel_revenue",
  ): PromiseLike<{ data: DashboardChannelRevenue[] | null; error: Error | null }>;
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
    unpaidInvoicesResult,
    demoClientResult,
  ] = await Promise.all([
    rpc.rpc("get_dashboard_totals"),
    rpc.rpc("get_dashboard_channel_revenue"),
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
  ]);

  if (totalsResult.error) {
    throw totalsResult.error;
  }

  if (channelRevenueResult.error) {
    throw channelRevenueResult.error;
  }

  if (unpaidInvoicesResult.error) {
    throw unpaidInvoicesResult.error;
  }

  if (demoClientResult.error) {
    throw demoClientResult.error;
  }

  const totals = totalsResult.data?.[0];
  const outstandingAmount = toAmount(totals?.outstanding_amount);
  const monthlyRevenue = toAmount(totals?.monthly_revenue);
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
        <div aria-hidden="true" className="text-3xl font-semibold text-blue-600">
          FS
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
        className="grid grid-cols-1 gap-lg md:grid-cols-2"
      >
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            미수금 합계
          </p>
          <p className="mt-md text-3xl font-bold tracking-tight text-red-700 tabular-nums">
            {formatKRW(outstandingAmount)}
          </p>
          <p className="mt-sm text-xs leading-relaxed text-text-muted">
            미입금 상태 인보이스의 청구 총액입니다.
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
            KST 입금월 기준 실지급액 합계입니다.
          </p>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-lg xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <Card className="p-0">
          <div className="border-b border-surface-border px-xl py-lg">
            <h3 className="text-lg font-semibold text-text-primary">
              임박/지연 지급기한
            </h3>
            <p className="mt-xs text-sm text-text-muted">
              미입금 인보이스 중 오늘 기준 지연 또는 7일 이내 항목입니다.
            </p>
          </div>

          {attentionInvoices.length === 0 ? (
            <div className="px-xl py-2xl text-sm text-text-muted">
              지연되었거나 곧 지급기한이 도래하는 인보이스가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-text-muted">
                  <tr>
                    <th scope="col" className="px-xl py-md">
                      클라이언트
                    </th>
                    <th scope="col" className="px-xl py-md">
                      계약
                    </th>
                    <th scope="col" className="px-xl py-md text-right">
                      금액
                    </th>
                    <th scope="col" className="px-xl py-md">
                      지급기한
                    </th>
                    <th scope="col" className="px-xl py-md">
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
                      <td className="px-xl py-lg text-text-body">
                        {invoice.client?.name ?? "클라이언트 없음"}
                      </td>
                      <td className="px-xl py-lg">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="font-medium text-text-primary hover:text-brand-primary"
                        >
                          {invoice.contract?.title ?? "계약 없음"}
                        </Link>
                      </td>
                      <td className="px-xl py-lg text-right font-medium tabular-nums text-text-primary">
                        {formatKRW(invoice.amount)}
                      </td>
                      <td
                        className={cn(
                          "px-xl py-lg font-medium tabular-nums",
                          invoice.dueStatus === "overdue"
                            ? "text-red-700"
                            : "text-amber-700",
                        )}
                      >
                        {formatDate(invoice.due_date)}
                      </td>
                      <td className="px-xl py-lg">
                        <DueStatusBadge status={invoice.dueStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

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
      </section>
    </div>
  );
}

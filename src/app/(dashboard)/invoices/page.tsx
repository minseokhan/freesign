import Link from "next/link";

import {
  PAYMENT_STATUSES,
  PAYMENT_STATUS_OPTIONS,
  PaymentStatusBadge,
  type PaymentStatus,
} from "@/components/payment-status-badge";
import { Card } from "@/components/ui/card";
import { notDeleted } from "@/lib/db";
import { deriveDueStatus, formatKRW } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type InvoiceRow = Pick<
  Database["public"]["Tables"]["invoices"]["Row"],
  | "id"
  | "amount"
  | "issue_date"
  | "due_date"
  | "payment_status"
  | "created_at"
> & {
  client: {
    name: string;
  } | null;
  contract: {
    title: string;
  } | null;
};

type InvoicesPageProps = {
  searchParams?: Promise<{
    status?: string;
  }>;
};

function parseStatusFilter(status: string | undefined): PaymentStatus | null {
  if (!status) {
    return null;
  }

  return PAYMENT_STATUSES.includes(status as PaymentStatus)
    ? (status as PaymentStatus)
    : null;
}

function formatDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);

  if (!match) {
    return date;
  }

  const [, year, month, day] = match;

  return `${year}.${month}.${day}`;
}

function isOverdue(invoice: Pick<InvoiceRow, "due_date" | "payment_status">) {
  return (
    deriveDueStatus(
      {
        dueDate: invoice.due_date,
        paymentStatus: invoice.payment_status,
      },
      new Date(),
    ) === "overdue"
  );
}

export default async function InvoicesPage({
  searchParams,
}: InvoicesPageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedStatus = parseStatusFilter(resolvedSearchParams?.status);
  const supabase = await createClient();

  let query = notDeleted(
    supabase
      .from("invoices")
      .select(
        "id,amount,issue_date,due_date,payment_status,created_at,client:clients(name),contract:contracts(title)",
      ),
  );

  if (selectedStatus) {
    query = query.eq("payment_status", selectedStatus);
  }

  const { data, error } = await query.order("issue_date", {
    ascending: false,
  });

  if (error) {
    throw error;
  }

  const invoices = (data ?? []) as InvoiceRow[];

  return (
    <div className="space-y-xl">
      <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
            인보이스
          </h2>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            발행일, 지급기한, 정산 상태를 한 화면에서 확인합니다.
          </p>
        </div>
        <Link
          href="/contracts"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          계약에서 발행
        </Link>
      </div>

      <nav aria-label="정산 상태 필터" className="flex flex-wrap gap-sm">
        {PAYMENT_STATUS_OPTIONS.map((option) => {
          const href =
            option.value === "all"
              ? "/invoices"
              : `/invoices?status=${option.value}`;
          const isActive =
            option.value === "all"
              ? selectedStatus === null
              : selectedStatus === option.value;

          return (
            <Link
              key={option.value}
              href={href}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-lg py-sm text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
                isActive
                  ? "border-blue-200 bg-brand-point text-brand-primary"
                  : "border-surface-border bg-white text-text-body hover:bg-surface-muted",
              )}
              aria-current={isActive ? "page" : undefined}
            >
              {option.label}
            </Link>
          );
        })}
      </nav>

      {invoices.length === 0 ? (
        <Card className="flex min-h-80 flex-col items-center justify-center gap-lg text-center">
          <div
            aria-hidden="true"
            className="text-3xl font-semibold text-blue-600"
          >
            FS
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">
              아직 인보이스가 없어요
            </h3>
            <p className="mt-sm max-w-md text-sm leading-relaxed text-text-muted">
              계약 상세에서 인보이스를 발행하면 청구 금액, 원천징수 스냅샷,
              지급기한을 정산 기록 체인으로 확인할 수 있습니다.
            </p>
          </div>
          <Link
            href="/contracts"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
          >
            계약 목록 보기
          </Link>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-text-muted">
                <tr>
                  <th scope="col" className="px-xl py-md">
                    클라이언트
                  </th>
                  <th scope="col" className="px-xl py-md">
                    계약
                  </th>
                  <th scope="col" className="px-xl py-md">
                    금액
                  </th>
                  <th scope="col" className="px-xl py-md">
                    상태
                  </th>
                  <th scope="col" className="px-xl py-md">
                    발행일
                  </th>
                  <th scope="col" className="px-xl py-md">
                    지급기한
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-xl py-md text-right"
                  >
                    상세
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {invoices.map((invoice) => {
                  const overdue = isOverdue(invoice);

                  return (
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
                      <td className="px-xl py-lg font-medium tabular-nums text-text-primary">
                        {formatKRW(invoice.amount)}
                      </td>
                      <td className="px-xl py-lg">
                        <PaymentStatusBadge
                          status={invoice.payment_status}
                          overdue={overdue}
                        />
                      </td>
                      <td className="px-xl py-lg text-text-body">
                        {formatDate(invoice.issue_date)}
                      </td>
                      <td
                        className={cn(
                          "px-xl py-lg text-text-body",
                          overdue && "font-medium text-red-700",
                        )}
                      >
                        {formatDate(invoice.due_date)}
                      </td>
                      <td className="whitespace-nowrap px-xl py-lg text-right">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="text-sm font-medium text-brand-primary hover:text-brand-hover"
                        >
                          보기
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

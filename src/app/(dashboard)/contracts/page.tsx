import Link from "next/link";

import {
  CONTRACT_STATUSES,
  CONTRACT_STATUS_OPTIONS,
  ContractStatusBadge,
  type ContractStatus,
} from "@/components/contract-status-badge";
import { Card } from "@/components/ui/card";
import { notDeleted } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type ContractRow = Pick<
  Database["public"]["Tables"]["contracts"]["Row"],
  "id" | "title" | "amount" | "start_date" | "end_date" | "status" | "created_at"
> & {
  client: {
    name: string;
  } | null;
};

type ContractsPageProps = {
  searchParams?: Promise<{
    status?: string;
  }>;
};

function parseStatusFilter(status: string | undefined): ContractStatus | null {
  if (!status) {
    return null;
  }

  return CONTRACT_STATUSES.includes(status as ContractStatus)
    ? (status as ContractStatus)
    : null;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: string) {
  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");

  return `${year}.${month}.${day}`;
}

function formatPeriod(startDate: string, endDate: string) {
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

export default async function ContractsPage({
  searchParams,
}: ContractsPageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedStatus = parseStatusFilter(resolvedSearchParams?.status);
  const supabase = await createClient();

  let query = notDeleted(
    supabase
      .from("contracts")
      .select("id,title,amount,start_date,end_date,status,created_at,client:clients(name)"),
  );

  if (selectedStatus) {
    query = query.eq("status", selectedStatus);
  }

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });

  if (error) {
    throw error;
  }

  const contracts = (data ?? []) as ContractRow[];

  return (
    <div className="space-y-xl">
      <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
            계약
          </h2>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            계약 기간, 금액, 상태를 한 화면에서 확인합니다.
          </p>
        </div>
        <Link
          href="/contracts/new"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          계약 만들기
        </Link>
      </div>

      <nav aria-label="계약 상태 필터" className="flex flex-wrap gap-sm">
        {CONTRACT_STATUS_OPTIONS.map((option) => {
          const href =
            option.value === "all"
              ? "/contracts"
              : `/contracts?status=${option.value}`;
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

      {contracts.length === 0 ? (
        <Card className="flex min-h-80 flex-col items-center justify-center gap-lg text-center">
          <div
            aria-hidden="true"
            className="text-3xl font-semibold text-blue-600"
          >
            FS
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">
              아직 계약이 없어요
            </h3>
            <p className="mt-sm max-w-md text-sm leading-relaxed text-text-muted">
              계약을 만들면 클라이언트, 금액, 기간, 서명 상태를 기록 체인의
              시작점으로 관리할 수 있습니다.
            </p>
          </div>
          <Link
            href="/contracts/new"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
          >
            계약 만들기
          </Link>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] border-collapse text-left text-sm">
              <thead className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-text-muted">
                <tr>
                  <th scope="col" className="px-xl py-md">
                    제목
                  </th>
                  <th scope="col" className="px-xl py-md">
                    클라이언트
                  </th>
                  <th scope="col" className="px-xl py-md text-right">
                    금액
                  </th>
                  <th scope="col" className="px-xl py-md">
                    상태
                  </th>
                  <th scope="col" className="px-xl py-md">
                    기간
                  </th>
                  <th scope="col" className="px-xl py-md text-right">
                    상세
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {contracts.map((contract) => (
                  <tr
                    key={contract.id}
                    className="transition-colors hover:bg-surface-muted"
                  >
                    <td className="px-xl py-lg">
                      <Link
                        href={`/contracts/${contract.id}`}
                        className="font-medium text-text-primary hover:text-brand-primary"
                      >
                        {contract.title}
                      </Link>
                    </td>
                    <td className="px-xl py-lg text-text-body">
                      {contract.client?.name ?? "클라이언트 없음"}
                    </td>
                    <td className="px-xl py-lg text-right font-medium tabular-nums text-text-primary">
                      {formatCurrency(contract.amount)}
                    </td>
                    <td className="px-xl py-lg">
                      <ContractStatusBadge status={contract.status} />
                    </td>
                    <td className="px-xl py-lg text-text-body">
                      {formatPeriod(contract.start_date, contract.end_date)}
                    </td>
                    <td className="px-xl py-lg text-right">
                      <Link
                        href={`/contracts/${contract.id}`}
                        className="text-sm font-medium text-brand-primary hover:text-brand-hover"
                      >
                        보기
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

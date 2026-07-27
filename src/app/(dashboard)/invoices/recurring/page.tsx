import Link from "next/link";

import { UpgradeCard } from "@/components/billing/upgrade-cta";
import {
  RecurringScheduleList,
  type RecurringScheduleItem,
} from "@/components/recurring-schedule-list";
import { getUserPlan } from "@/lib/plan";
import {
  RECURRING_FILTER_OPTIONS,
  parseRecurringFilter,
} from "@/lib/recurring/filter";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type RecurringRow = {
  id: string;
  amount: number;
  net_amount: number;
  interval_kind: "weekly" | "monthly";
  next_run_at: string;
  active: boolean;
  contract: { title: string } | null;
  client: { name: string } | null;
};

type RecurringInvoicesPageProps = {
  searchParams?: Promise<{ state?: string }>;
};

export default async function RecurringInvoicesPage({
  searchParams,
}: RecurringInvoicesPageProps) {
  const plan = await getUserPlan();

  if (plan !== "pro") {
    return (
      <div className="space-y-xl">
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
          반복 인보이스
        </h2>
        <UpgradeCard
          title="반복 인보이스"
          description="리테이너·구독 계약을 매 주기 자동으로 청구 초안으로 만들어 드려요. Pro로 업그레이드하면 바로 쓸 수 있어요."
        />
      </div>
    );
  }

  const resolvedSearchParams = await searchParams;
  const selectedFilter = parseRecurringFilter(resolvedSearchParams?.state);
  const supabase = await createClient();

  let query = supabase
    .from("recurring_invoices")
    .select(
      "id,amount,net_amount,interval_kind,next_run_at,active,contract:contracts(title),client:clients(name)",
    );

  if (selectedFilter !== "all") {
    query = query.eq("active", selectedFilter === "active");
  }

  const { data } = await query.order("created_at", { ascending: false });

  const schedules: RecurringScheduleItem[] = ((data ?? []) as RecurringRow[]).map(
    (row) => ({
      id: row.id,
      contractTitle: row.contract?.title ?? "(제목 없음)",
      clientName: row.client?.name ?? "클라이언트 없음",
      amount: row.amount,
      netAmount: row.net_amount,
      intervalKind: row.interval_kind,
      nextRunAt: row.next_run_at,
      active: row.active,
    }),
  );

  return (
    <div className="space-y-xl">
      <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
            반복 인보이스
          </h2>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            매 주기 인보이스 초안을 자동 생성합니다. 초안은 자동 발행되지 않으며,
            검토 후 직접 발행해야 합니다.
          </p>
        </div>
        <Link
          href="/invoices/recurring/new"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          새 반복 스케줄
        </Link>
      </div>

      <nav aria-label="스케줄 상태 필터" className="flex flex-wrap gap-sm">
        {RECURRING_FILTER_OPTIONS.map((option) => {
          const href =
            option.value === "all"
              ? "/invoices/recurring"
              : `/invoices/recurring?state=${option.value}`;
          const isActive = selectedFilter === option.value;

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

      <RecurringScheduleList schedules={schedules} />
    </div>
  );
}

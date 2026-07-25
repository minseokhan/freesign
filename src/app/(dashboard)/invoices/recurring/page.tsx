import Link from "next/link";

import { UpgradeCard } from "@/components/billing/upgrade-cta";
import { RecurringScheduleForm } from "@/components/recurring-schedule-form";
import {
  RecurringScheduleList,
  type RecurringScheduleItem,
} from "@/components/recurring-schedule-list";
import { notDeleted } from "@/lib/db";
import { getUserPlan } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";

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

export default async function RecurringInvoicesPage() {
  const plan = await getUserPlan();
  const supabase = await createClient();

  const backLink = (
    <Link
      href="/invoices"
      className="text-sm font-medium text-text-muted hover:text-brand-primary"
    >
      인보이스 목록
    </Link>
  );

  if (plan !== "pro") {
    return (
      <div className="mx-auto max-w-3xl space-y-xl">
        <div>
          {backLink}
          <h2 className="mt-sm text-2xl font-semibold tracking-tight text-text-primary">
            반복 인보이스
          </h2>
        </div>
        <UpgradeCard
          title="반복 인보이스"
          description="리테이너·구독 계약을 매 주기 자동으로 청구 초안으로 만들어 드려요. Pro로 업그레이드하면 바로 쓸 수 있어요."
        />
      </div>
    );
  }

  const [{ data: scheduleData }, { data: contractData }] = await Promise.all([
    supabase
      .from("recurring_invoices")
      .select(
        "id,amount,net_amount,interval_kind,next_run_at,active,contract:contracts(title),client:clients(name)",
      )
      .order("created_at", { ascending: false }),
    notDeleted(supabase.from("contracts").select("id,title"))
      .neq("status", "canceled")
      .order("created_at", { ascending: false }),
  ]);

  const schedules: RecurringScheduleItem[] = ((scheduleData ?? []) as RecurringRow[]).map(
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

  const contracts = ((contractData ?? []) as { id: string; title: string }[]).map(
    (c) => ({ id: c.id, title: c.title }),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-xl">
      <div>
        {backLink}
        <h2 className="mt-sm text-2xl font-semibold tracking-tight text-text-primary">
          반복 인보이스
        </h2>
        <p className="mt-sm text-sm leading-relaxed text-text-muted">
          매 주기 인보이스 초안을 자동 생성합니다. 초안은 자동 발행되지 않으며, 검토 후 직접 발행해야 합니다.
        </p>
      </div>

      <RecurringScheduleForm contracts={contracts} />
      <RecurringScheduleList schedules={schedules} />
    </div>
  );
}

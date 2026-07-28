import Link from "next/link";

import { UpgradeCard } from "@/components/billing/upgrade-cta";
import { RecurringScheduleForm } from "@/components/recurring-schedule-form";
import { notDeleted } from "@/lib/db";
import { getUserPlan } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";

export default async function NewRecurringInvoicePage() {
  const plan = await getUserPlan();

  const backLink = (
    <Link
      href="/invoices/recurring"
      className="text-sm font-medium text-text-muted hover:text-brand-primary"
    >
      반복 인보이스
    </Link>
  );

  if (plan !== "pro") {
    return (
      <div className="mx-auto max-w-3xl space-y-xl">
        <div>
          {backLink}
          <h2 className="mt-sm text-2xl font-semibold tracking-tight text-text-primary">
            새 반복 인보이스 발행
          </h2>
        </div>
        <UpgradeCard
          title="반복 인보이스"
          description="리테이너·구독 계약을 매 주기 자동으로 청구 초안으로 만들어 드려요. Pro로 업그레이드하면 바로 쓸 수 있어요."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await notDeleted(
    supabase.from("contracts").select("id,title"),
  )
    .neq("status", "canceled")
    .order("created_at", { ascending: false });

  const contracts = ((data ?? []) as { id: string; title: string }[]).map(
    (c) => ({ id: c.id, title: c.title }),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-xl">
      <div>
        {backLink}
        <h2 className="mt-sm text-2xl font-semibold tracking-tight text-text-primary">
          새 반복 인보이스 발행
        </h2>
      </div>

      <RecurringScheduleForm contracts={contracts} />
    </div>
  );
}

import { PlanBadge } from "@/components/billing/plan-badge";
import {
  ManageSubscriptionButton,
  UpgradeButton,
} from "@/components/billing/upgrade-cta";
import { ProfileForm } from "@/components/profile-form";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getUserPlan } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  | "display_name"
  | "default_withholding_type"
  | "bank_name"
  | "bank_account_number"
  | "bank_account_holder"
>;

export default async function SettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data, error }, plan] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "display_name,default_withholding_type,bank_name,bank_account_number,bank_account_holder",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    getUserPlan(),
  ]);

  if (error) {
    throw error;
  }

  const profile = data as ProfileRow | null;

  return (
    <div className="mx-auto max-w-3xl space-y-xl">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
          설정
        </h2>
        <p className="mt-xs text-sm leading-relaxed text-text-muted">
          프로필과 입금 계좌, 기본 원천징수율을 관리합니다.
        </p>
      </div>

      <Card className="space-y-md">
        <div className="flex items-center justify-between gap-lg">
          <div>
            <div className="flex items-center gap-sm">
              <h3 className="text-lg font-semibold text-text-primary">플랜</h3>
              <PlanBadge plan={plan} />
            </div>
            <p className="mt-xs text-sm leading-relaxed text-text-muted">
              {plan === "pro"
                ? "새 계약 생성·서명, 계약 불러오기, 세금 CSV·고급 대시보드를 모두 무제한으로 쓸 수 있어요."
                : "새 계약은 1건, 계약 불러오기는 누적 5회까지 무료예요. Pro로 업그레이드하면 전부 무제한이에요."}
            </p>
          </div>
          {plan === "pro" ? <ManageSubscriptionButton /> : <UpgradeButton />}
        </div>
      </Card>

      <ProfileForm
        defaultValues={{
          display_name: profile?.display_name ?? "",
          default_withholding_type:
            profile?.default_withholding_type ?? "none",
          bank_name: profile?.bank_name ?? "",
          bank_account_number: profile?.bank_account_number ?? "",
          bank_account_holder: profile?.bank_account_holder ?? "",
        }}
      />
    </div>
  );
}

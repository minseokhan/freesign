import { ProfileForm } from "@/components/profile-form";
import { requireUser } from "@/lib/auth";
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

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "display_name,default_withholding_type,bank_name,bank_account_number,bank_account_holder",
    )
    .eq("user_id", user.id)
    .maybeSingle();

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

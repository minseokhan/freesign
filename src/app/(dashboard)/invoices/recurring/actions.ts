"use server";

// 반복 인보이스 스케줄 CRUD. 생성은 assertProFeature 게이트 + client 입력 allowlist + calcWithholding
// 세금 스냅샷. 소유권(계약)은 Server Action에서 재조회 검증(FK는 RLS 우회). pause/resume/delete는
// 본인 데이터 관리이므로 게이트 없음(다운그레이드해도 스케줄을 정리·보존할 수 있어야 함).
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { dbError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { assertOwned, notDeleted } from "@/lib/db";
import { assertProFeature } from "@/lib/plan";
import { getPostHogClient } from "@/lib/posthog-server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { calcWithholding } from "@/lib/tax";
import { WITHHOLDING_TYPES } from "@/lib/validation/invoice";

export type RecurringActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const createSchema = z.object({
  contract_id: z.string().uuid(),
  amount: z.coerce.number().int().positive(),
  withholding_type: z.enum(WITHHOLDING_TYPES),
  interval_kind: z.enum(["weekly", "monthly"]),
  next_run_at: z.string().trim().date(),
  due_offset_days: z.coerce.number().int().min(0).max(365).optional(),
});

export async function createRecurringSchedule(
  input: unknown,
): Promise<RecurringActionResult> {
  const user = await requireUser();

  const gate = await assertProFeature();
  if (!gate.ok) return { ok: false, error: gate.message };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "입력값을 확인해 주세요." };

  const supabase = await createSupabaseClient();

  const owned = await assertOwned(supabase, "contracts", parsed.data.contract_id);
  if (!owned) return { ok: false, error: "계약을 찾을 수 없습니다." };

  const { data: contract, error: contractError } = await notDeleted(
    supabase
      .from("contracts")
      .select("client_id,status")
      .eq("id", parsed.data.contract_id),
  ).maybeSingle();

  if (contractError) return dbError(contractError);
  if (!contract) return { ok: false, error: "계약을 찾을 수 없습니다." };
  if (contract.status === "canceled") {
    return { ok: false, error: "취소된 계약에는 반복 인보이스를 만들 수 없습니다." };
  }

  const { withholding, net } = calcWithholding(
    parsed.data.amount,
    parsed.data.withholding_type,
  );

  const { data, error } = await supabase
    .from("recurring_invoices")
    .insert({
      user_id: user.id,
      contract_id: parsed.data.contract_id,
      client_id: contract.client_id,
      amount: parsed.data.amount,
      withholding_type: parsed.data.withholding_type,
      withholding_amount: withholding,
      net_amount: net,
      interval_kind: parsed.data.interval_kind,
      next_run_at: parsed.data.next_run_at,
      due_offset_days: parsed.data.due_offset_days ?? 14,
    })
    .select("id")
    .single();

  if (error) return dbError(error);

  revalidatePath("/invoices/recurring");

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "recurring_schedule_created",
    properties: { recurring_id: data.id, interval: parsed.data.interval_kind },
  });
  await posthog.flush();

  return { ok: true, id: data.id };
}

export async function setRecurringActive(
  id: string,
  active: boolean,
): Promise<RecurringActionResult> {
  const user = await requireUser();

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "스케줄을 찾을 수 없습니다." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("recurring_invoices")
    .update({ active })
    .eq("id", parsed.data);

  if (error) return dbError(error);

  revalidatePath("/invoices/recurring");

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: active ? "recurring_schedule_resumed" : "recurring_schedule_paused",
    properties: { recurring_id: parsed.data },
  });
  await posthog.flush();

  return { ok: true, id: parsed.data };
}

export async function deleteRecurringSchedule(
  id: string,
): Promise<RecurringActionResult> {
  const user = await requireUser();

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "스케줄을 찾을 수 없습니다." };

  // 스케줄 소유는 RLS delete_own이 강제한다(타인 소유 id면 0행 삭제 → 에러 없이 무시).
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("recurring_invoices")
    .delete()
    .eq("id", parsed.data);

  if (error) return dbError(error);

  revalidatePath("/invoices/recurring");

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "recurring_schedule_deleted",
    properties: { recurring_id: parsed.data },
  });
  await posthog.flush();

  return { ok: true, id: parsed.data };
}

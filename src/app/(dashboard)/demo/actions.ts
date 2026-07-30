"use server";

import { revalidatePath } from "next/cache";

import { dbError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { getPostHogClient } from "@/lib/posthog-server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

type ActionResult = { ok: true } | { ok: false; error: string };

// 데모 픽스처(클라이언트·계약·인보이스 값)는 0039 seed_demo_data RPC가 소유한다.

function revalidateDemoPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  revalidatePath("/contracts");
  revalidatePath("/invoices");
}

export async function seedDemoData(): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createSupabaseClient();

  // 데모 행은 is_demo=true(=0007 물리삭제 정책의 열쇠)라 서버 소유 필드다. 0039에서
  // 클라이언트 INSERT 컬럼 권한을 회수했으므로 시드 전체를 DEFINER RPC가 만든다
  // (멱등 — 이미 데모가 있으면 false를 돌려주고 아무것도 만들지 않는다).
  const { error } = await supabase.rpc("seed_demo_data");

  if (error) {
    return dbError(error);
  }

  revalidateDemoPaths();

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "demo_seeded" });
  await posthog.flush();

  return { ok: true };
}

export async function clearDemoData(): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createSupabaseClient();

  const { data: demoInvoices, error: invoiceIdsError } = await supabase
    .from("invoices")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_demo", true);

  if (invoiceIdsError) {
    return dbError(invoiceIdsError);
  }

  const { data: demoContracts, error: contractIdsError } = await supabase
    .from("contracts")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_demo", true);

  if (contractIdsError) {
    return dbError(contractIdsError);
  }

  const { error: clientIdsError } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_demo", true);

  if (clientIdsError) {
    return dbError(clientIdsError);
  }

  const invoiceIds = (demoInvoices ?? []).map(({ id }) => id);
  const contractIds = (demoContracts ?? []).map(({ id }) => id);

  if (invoiceIds.length > 0) {
    const { error } = await supabase
      .from("invoice_events")
      .delete()
      .in("invoice_id", invoiceIds);

    if (error) {
      return dbError(error);
    }
  }

  if (contractIds.length > 0) {
    const { error } = await supabase
      .from("contract_events")
      .delete()
      .in("contract_id", contractIds);

    if (error) {
      return dbError(error);
    }
  }

  const { error: invoicesDeleteError } = await supabase
    .from("invoices")
    .delete()
    .eq("user_id", user.id)
    .eq("is_demo", true);

  if (invoicesDeleteError) {
    return dbError(invoicesDeleteError);
  }

  const { error: contractsDeleteError } = await supabase
    .from("contracts")
    .delete()
    .eq("user_id", user.id)
    .eq("is_demo", true);

  if (contractsDeleteError) {
    return dbError(contractsDeleteError);
  }

  const { error: clientsDeleteError } = await supabase
    .from("clients")
    .delete()
    .eq("user_id", user.id)
    .eq("is_demo", true);

  if (clientsDeleteError) {
    return dbError(clientsDeleteError);
  }

  revalidateDemoPaths();

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "demo_cleared" });
  await posthog.flush();

  return { ok: true };
}

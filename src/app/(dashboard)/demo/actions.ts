"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { calcWithholding } from "@/lib/tax";
import type { Database, Json } from "@/types/database";

type ActionResult = { ok: true } | { ok: false; error: string };
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ContractInsert = Database["public"]["Tables"]["contracts"]["Insert"];
type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type ContractEventInsert =
  Database["public"]["Tables"]["contract_events"]["Insert"];
type InvoiceEventInsert =
  Database["public"]["Tables"]["invoice_events"]["Insert"];

const demoClauses = [
  {
    title: "업무 범위",
    body: "김하나는 무디의 브랜드 로고 리뉴얼과 인스타그램 템플릿 5종 제작 업무를 수행한다.",
    plain_summary: "로고와 인스타 템플릿 5개를 3주 안에 만든다는 뜻입니다.",
    needs_review: false,
  },
  {
    title: "대금 및 지급",
    body: "무디는 본 계약의 대가로 총 3,000,000원을 지급하며, 인보이스에 명시된 지급기한까지 입금한다.",
    plain_summary: "총 대금은 300만원이고 청구서 기한까지 입금합니다.",
    needs_review: false,
  },
  {
    title: "저작권 및 사용권",
    body: "최종 산출물의 사용 범위와 원본 파일 제공 여부는 당사자 간 별도 합의에 따른다.",
    plain_summary: "산출물을 어디까지 쓸 수 있는지는 별도 확인이 필요합니다.",
    needs_review: true,
  },
] satisfies Json[];

function dbError(error: { message?: string } | null | undefined): ActionResult {
  return {
    ok: false,
    error: error?.message ?? "요청을 처리하지 못했습니다.",
  };
}

function revalidateDemoPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  revalidatePath("/contracts");
  revalidatePath("/invoices");
}

export async function seedDemoData(): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createSupabaseClient();

  const { data: existingDemo, error: existingDemoError } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_demo", true)
    .limit(1)
    .maybeSingle();

  if (existingDemoError) {
    return dbError(existingDemoError);
  }

  if (existingDemo) {
    revalidateDemoPaths();
    return { ok: true };
  }

  const clientPayload = {
    user_id: user.id,
    name: "무디",
    channel: "instagram",
    contact_email: "hello@moodi.example",
    memo: "인스타그램 DM으로 문의한 카페 브랜드",
    is_demo: true,
  } satisfies ClientInsert;

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .insert(clientPayload)
    .select("id")
    .single();

  if (clientError) {
    return dbError(clientError);
  }

  const contractPayload = {
    user_id: user.id,
    client_id: client.id,
    title: "무디 브랜드 리뉴얼",
    scope: "브랜드 로고 리뉴얼 + 인스타 템플릿 5종",
    amount: 3_000_000,
    start_date: "2026-07-01",
    end_date: "2026-07-21",
    status: "signed",
    clauses: demoClauses,
    is_demo: true,
  } satisfies ContractInsert;

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .insert(contractPayload)
    .select("id")
    .single();

  if (contractError) {
    return dbError(contractError);
  }

  const { withholding, net } = calcWithholding(3_000_000, "wt_3_3");
  const invoicePayload = {
    user_id: user.id,
    contract_id: contract.id,
    client_id: client.id,
    amount: 3_000_000,
    issue_date: "2026-07-22",
    due_date: "2026-08-05",
    withholding_type: "wt_3_3",
    withholding_amount: withholding,
    net_amount: net,
    payment_status: "paid",
    paid_at: "2026-08-05T09:00:00+09:00",
    payment_method: "bank_transfer",
    is_demo: true,
  } satisfies InvoiceInsert;

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert(invoicePayload)
    .select("id")
    .single();

  if (invoiceError) {
    return dbError(invoiceError);
  }

  const contractEventPayload = {
    user_id: user.id,
    contract_id: contract.id,
    actor: user.id,
    from_status: null,
    to_status: "signed",
    event_type: "contract.demo_seeded",
    meta: {
      client_id: client.id,
    },
  } satisfies ContractEventInsert;
  const { error: contractEventError } = await supabase
    .from("contract_events")
    .insert(contractEventPayload);

  if (contractEventError) {
    return dbError(contractEventError);
  }

  const invoiceEventPayload = {
    user_id: user.id,
    invoice_id: invoice.id,
    actor: user.id,
    from_status: null,
    to_status: "paid",
    event_type: "invoice.demo_seeded",
    meta: {
      contract_id: contract.id,
      client_id: client.id,
      payment_method: "bank_transfer",
    },
  } satisfies InvoiceEventInsert;
  const { error: invoiceEventError } = await supabase
    .from("invoice_events")
    .insert(invoiceEventPayload);

  if (invoiceEventError) {
    return dbError(invoiceEventError);
  }

  revalidateDemoPaths();

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

  return { ok: true };
}

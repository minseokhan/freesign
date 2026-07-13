"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { assertOwned, notDeleted } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { calcWithholding } from "@/lib/tax";
import {
  invoiceInputSchema,
  type InvoiceInput,
} from "@/lib/validation/invoice";
import type { Database } from "@/types/database";

type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];
type InvoiceEventInsert =
  Database["public"]["Tables"]["invoice_events"]["Insert"];
type InvoicePaymentStatus = Database["public"]["Enums"]["payment_status"];

const invoicePaymentTransitionSchema = z.enum(["paid", "unpaid"]);
const invoicePaymentInputSchema = z.object({
  payment_method: z.string().trim().max(50).optional(),
});

export type InvoiceActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Partial<Record<keyof InvoiceInput, string[]>>;
    };

function validationError(error: z.ZodError): InvoiceActionResult {
  return {
    ok: false,
    error: "입력값을 확인해 주세요.",
    fieldErrors: error.flatten().fieldErrors,
  };
}

function dbError(error: { message?: string }): InvoiceActionResult {
  return {
    ok: false,
    error: error.message ?? "요청을 처리하지 못했습니다.",
  };
}

function parseInvoiceInput(input: unknown): InvoiceInput | InvoiceActionResult {
  const result = invoiceInputSchema.safeParse(input);

  if (!result.success) {
    return validationError(result.error);
  }

  return result.data;
}

export async function createInvoice(
  input: unknown,
): Promise<InvoiceActionResult> {
  const user = await requireUser();
  const parsed = parseInvoiceInput(input);

  if ("ok" in parsed) {
    return parsed;
  }

  const supabase = await createSupabaseClient();
  const owned = await assertOwned(supabase, "contracts", parsed.contract_id);

  if (!owned) {
    return { ok: false, error: "계약을 찾을 수 없습니다." };
  }

  const { data: contract, error: contractError } = await notDeleted(
    supabase
      .from("contracts")
      .select("id,client_id,status")
      .eq("id", parsed.contract_id),
  ).maybeSingle();

  if (contractError) {
    return dbError(contractError);
  }

  if (!contract) {
    return { ok: false, error: "계약을 찾을 수 없습니다." };
  }

  if (contract.status === "canceled") {
    return { ok: false, error: "취소된 계약에는 인보이스를 발행할 수 없습니다." };
  }

  const { withholding, net } = calcWithholding(
    parsed.amount,
    parsed.withholding_type,
  );
  const payload = {
    user_id: user.id,
    contract_id: parsed.contract_id,
    client_id: contract.client_id,
    amount: parsed.amount,
    issue_date: parsed.issue_date,
    due_date: parsed.due_date,
    withholding_type: parsed.withholding_type,
    withholding_amount: withholding,
    net_amount: net,
    payment_status: "unpaid",
  } satisfies InvoiceInsert;

  const { data, error } = await supabase
    .from("invoices")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    return dbError(error);
  }

  const eventPayload = {
    user_id: user.id,
    invoice_id: data.id,
    actor: user.id,
    from_status: null,
    to_status: "unpaid",
    event_type: "invoice.issued",
    meta: {
      contract_id: parsed.contract_id,
      client_id: contract.client_id,
    },
  } satisfies InvoiceEventInsert;

  await supabase.from("invoice_events").insert(eventPayload);

  revalidatePath("/invoices");
  revalidatePath(`/contracts/${parsed.contract_id}`);
  revalidatePath(`/invoices/${data.id}`);

  return { ok: true, id: data.id };
}

export async function setInvoicePayment(
  id: string,
  toStatus: unknown,
  input?: unknown,
): Promise<InvoiceActionResult> {
  const user = await requireUser();

  if (!id.trim()) {
    return { ok: false, error: "인보이스를 찾을 수 없습니다." };
  }

  const parsedStatus = invoicePaymentTransitionSchema.safeParse(toStatus);

  if (!parsedStatus.success) {
    return { ok: false, error: "허용되지 않는 정산 상태입니다." };
  }

  const parsedInput = invoicePaymentInputSchema.safeParse(input ?? {});

  if (!parsedInput.success) {
    return { ok: false, error: "입력값을 확인해 주세요." };
  }

  const supabase = await createSupabaseClient();
  const { data: invoice, error: invoiceError } = await notDeleted(
    supabase
      .from("invoices")
      .select("id,payment_status")
      .eq("id", id),
  ).maybeSingle();

  if (invoiceError) {
    return dbError(invoiceError);
  }

  if (!invoice) {
    return { ok: false, error: "인보이스를 찾을 수 없습니다." };
  }

  const fromStatus = invoice.payment_status as InvoicePaymentStatus;
  const nextStatus = parsedStatus.data;

  if (fromStatus === nextStatus) {
    return { ok: true, id };
  }

  const allowed =
    (fromStatus === "unpaid" && nextStatus === "paid") ||
    (fromStatus === "paid" && nextStatus === "unpaid");

  if (!allowed) {
    return {
      ok: false,
      error: "허용되지 않는 정산 상태 전이입니다.",
    };
  }

  const paymentMethod =
    nextStatus === "paid"
      ? (parsedInput.data.payment_method?.trim() || null)
      : null;
  const payload = {
    payment_status: nextStatus,
    paid_at: nextStatus === "paid" ? new Date().toISOString() : null,
    payment_method: paymentMethod,
  } satisfies InvoiceUpdate;

  const { data, error } = await supabase
    .from("invoices")
    .update(payload)
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return dbError(error);
  }

  const eventPayload = {
    user_id: user.id,
    invoice_id: id,
    actor: user.id,
    from_status: fromStatus,
    to_status: nextStatus,
    event_type: "invoice.payment_changed",
    meta: {
      payment_method: paymentMethod,
    },
  } satisfies InvoiceEventInsert;

  const { error: eventError } = await supabase
    .from("invoice_events")
    .insert(eventPayload);

  if (eventError) {
    return dbError(eventError);
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);

  return { ok: true, id: data.id };
}

export async function deleteInvoice(id: string): Promise<InvoiceActionResult> {
  await requireUser();

  if (!id.trim()) {
    return { ok: false, error: "인보이스를 찾을 수 없습니다." };
  }

  const supabase = await createSupabaseClient();
  const owned = await assertOwned(supabase, "invoices", id);

  if (!owned) {
    return { ok: false, error: "인보이스를 찾을 수 없습니다." };
  }

  const { data, error } = await supabase
    .from("invoices")
    .update({ deleted_at: new Date().toISOString() } satisfies InvoiceUpdate)
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return dbError(error);
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);

  return { ok: true, id: data.id };
}

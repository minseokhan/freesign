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
type InvoiceEventInsert =
  Database["public"]["Tables"]["invoice_events"]["Insert"];

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

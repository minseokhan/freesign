"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { toContractClauses } from "@/lib/contracts/draft";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  contractDraftInputSchema,
  type ContractDraftInput,
} from "@/lib/validation/contract";
import { generateContractDraft } from "@/services/ai/contract-draft";
import type { Database, Json } from "@/types/database";

type ContractInsert = Database["public"]["Tables"]["contracts"]["Insert"];
type ContractUpdate = Database["public"]["Tables"]["contracts"]["Update"];

export type ContractActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Partial<Record<keyof ContractDraftInput, string[]>>;
    };

function validationError(error: z.ZodError): ContractActionResult {
  return {
    ok: false,
    error: "입력값을 확인해 주세요.",
    fieldErrors: error.flatten().fieldErrors,
  };
}

function dbError(error: { message?: string }): ContractActionResult {
  return {
    ok: false,
    error: error.message ?? "요청을 처리하지 못했습니다.",
  };
}

function parseContractInput(
  input: unknown,
): ContractDraftInput | ContractActionResult {
  const result = contractDraftInputSchema.safeParse(input);

  if (!result.success) {
    return validationError(result.error);
  }

  return result.data;
}

export async function createContractDraft(
  input: unknown,
): Promise<ContractActionResult> {
  const user = await requireUser();
  const parsed = parseContractInput(input);

  if ("ok" in parsed) {
    return parsed;
  }

  const supabase = await createSupabaseClient();
  const owned = await assertOwned(supabase, "clients", parsed.client_id);

  if (!owned) {
    return { ok: false, error: "클라이언트를 찾을 수 없습니다." };
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("name")
    .eq("id", parsed.client_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (clientError) {
    return dbError(clientError);
  }

  if (!client) {
    return { ok: false, error: "클라이언트를 찾을 수 없습니다." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return dbError(profileError);
  }

  const draft = await generateContractDraft({
    freelancerName: profile?.display_name ?? user.email ?? "프리랜서",
    clientName: client.name,
    scope: parsed.scope,
    amount: parsed.amount,
    startDate: parsed.start_date,
    endDate: parsed.end_date,
    dueDate: parsed.due_date,
  });
  const clauses = toContractClauses(draft) as Json;

  const { data: existingDraft, error: existingDraftError } = await supabase
    .from("contracts")
    .select("id")
    .eq("client_id", parsed.client_id)
    .eq("status", "draft")
    .eq("scope", parsed.scope)
    .eq("amount", parsed.amount)
    .eq("start_date", parsed.start_date)
    .eq("end_date", parsed.end_date)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingDraftError) {
    return dbError(existingDraftError);
  }

  const payload = {
    title: draft.title,
    scope: parsed.scope,
    amount: parsed.amount,
    start_date: parsed.start_date,
    end_date: parsed.end_date,
    status: "draft",
    clauses,
  } satisfies ContractUpdate;

  if (existingDraft) {
    const { data, error } = await supabase
      .from("contracts")
      .update(payload)
      .eq("id", existingDraft.id)
      .select("id")
      .single();

    if (error) {
      return dbError(error);
    }

    revalidatePath("/contracts");
    revalidatePath(`/contracts/${data.id}`);

    return { ok: true, id: data.id };
  }

  const insertPayload = {
    ...payload,
    user_id: user.id,
    client_id: parsed.client_id,
  } satisfies ContractInsert;

  const { data, error } = await supabase
    .from("contracts")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    return dbError(error);
  }

  revalidatePath("/contracts");

  return { ok: true, id: data.id };
}

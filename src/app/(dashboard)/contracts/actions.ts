"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  CONTRACT_STATUSES,
  getContractStatusTransition,
  type ContractStatus,
} from "@/lib/contract-status";
import { toContractClauses } from "@/lib/contracts/draft";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  contractClausesInputSchema,
  contractDraftInputSchema,
  contractImportInputSchema,
  type ContractClausesInput,
  type ContractDraftInput,
  type ContractImportInput,
} from "@/lib/validation/contract";
import { generateContractDraft } from "@/services/ai/contract-draft";
import type { Database, Json } from "@/types/database";

const CONTRACT_ARTIFACTS_BUCKET = "contract-artifacts";
const MAX_SOURCE_PDF_SIZE_BYTES = 5 * 1024 * 1024;

type ContractInsert = Database["public"]["Tables"]["contracts"]["Insert"];
type ContractUpdate = Database["public"]["Tables"]["contracts"]["Update"];
type ContractEventInsert =
  Database["public"]["Tables"]["contract_events"]["Insert"];
type ContractActionField =
  | keyof ContractDraftInput
  | keyof ContractClausesInput
  | keyof ContractImportInput;
const contractStatusInputSchema = z.enum(CONTRACT_STATUSES);

export type ContractActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Partial<Record<ContractActionField, string[]>>;
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

function parseClausesInput(
  input: unknown,
): ContractClausesInput | ContractActionResult {
  const result = contractClausesInputSchema.safeParse(input);

  if (!result.success) {
    return validationError(result.error);
  }

  return result.data;
}

function parseImportedContractPayload(
  formData: FormData,
): ContractImportInput | ContractActionResult {
  const payload = formData.get("payload");

  if (typeof payload !== "string") {
    return { ok: false, error: "입력값을 확인해 주세요." };
  }

  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    return { ok: false, error: "입력값을 확인해 주세요." };
  }

  const result = contractImportInputSchema.safeParse(parsedPayload);

  if (!result.success) {
    return validationError(result.error);
  }

  return result.data;
}

function isValidSourcePdf(value: FormDataEntryValue | null): value is File {
  return (
    typeof File !== "undefined" &&
    value instanceof File &&
    value.type === "application/pdf" &&
    value.size <= MAX_SOURCE_PDF_SIZE_BYTES
  );
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

export async function createImportedContract(
  formData: FormData,
): Promise<ContractActionResult> {
  const user = await requireUser();
  const parsed = parseImportedContractPayload(formData);

  if ("ok" in parsed) {
    return parsed;
  }

  const supabase = await createSupabaseClient();
  const owned = await assertOwned(supabase, "clients", parsed.client_id);

  if (!owned) {
    return { ok: false, error: "클라이언트를 찾을 수 없습니다." };
  }

  const insertPayload = {
    user_id: user.id,
    client_id: parsed.client_id,
    title: parsed.title,
    scope: parsed.scope,
    amount: parsed.amount,
    start_date: parsed.start_date,
    end_date: parsed.end_date,
    status: "draft",
    clauses: parsed.clauses as Json,
  } satisfies ContractInsert;

  const { data, error } = await supabase
    .from("contracts")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    return dbError(error);
  }

  const contractId = data.id;
  const sourcePdf = formData.get("file");

  if (isValidSourcePdf(sourcePdf)) {
    const sourcePdfKey = `${user.id}/${contractId}/source.pdf`;
    const buffer = Buffer.from(await sourcePdf.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(CONTRACT_ARTIFACTS_BUCKET)
      .upload(sourcePdfKey, buffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("Failed to upload imported contract source PDF", {
        contractId,
        error: uploadError.message,
      });
    } else {
      const { error: updateError } = await supabase
        .from("contracts")
        .update({ source_pdf_url: sourcePdfKey } satisfies ContractUpdate)
        .eq("id", contractId);

      if (updateError) {
        console.error("Failed to store imported contract source PDF key", {
          contractId,
          error: updateError.message,
        });
      }
    }
  }

  const eventPayload = {
    user_id: user.id,
    contract_id: contractId,
    actor: user.id,
    from_status: null,
    to_status: "draft",
    event_type: "contract.imported",
    meta: { source: "pdf_import" },
  } satisfies ContractEventInsert;

  await supabase.from("contract_events").insert(eventPayload);

  revalidatePath("/contracts");

  return { ok: true, id: contractId };
}

export async function updateContractClauses(
  id: string,
  input: unknown,
): Promise<ContractActionResult> {
  await requireUser();

  if (!id.trim()) {
    return { ok: false, error: "계약을 찾을 수 없습니다." };
  }

  const parsed = parseClausesInput(input);

  if ("ok" in parsed) {
    return parsed;
  }

  const supabase = await createSupabaseClient();
  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id,status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (contractError) {
    return dbError(contractError);
  }

  if (!contract) {
    return { ok: false, error: "계약을 찾을 수 없습니다." };
  }

  if (contract.status !== "draft") {
    return {
      ok: false,
      error: "초안 상태의 계약만 조항을 편집할 수 있습니다.",
    };
  }

  const payload = {
    clauses: parsed.clauses as Json,
  } satisfies ContractUpdate;

  const { data, error } = await supabase
    .from("contracts")
    .update(payload)
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return dbError(error);
  }

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${id}`);

  return { ok: true, id: data.id };
}

export async function transitionContractStatus(
  id: string,
  toStatus: unknown,
): Promise<ContractActionResult> {
  const user = await requireUser();

  if (!id.trim()) {
    return { ok: false, error: "계약을 찾을 수 없습니다." };
  }

  const parsedStatus = contractStatusInputSchema.safeParse(toStatus);

  if (!parsedStatus.success) {
    return { ok: false, error: "허용되지 않는 계약 상태입니다." };
  }

  if (parsedStatus.data === "signed") {
    return {
      ok: false,
      error: "서명 완료 전이는 서명 절차에서만 처리할 수 있습니다.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id,status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (contractError) {
    return dbError(contractError);
  }

  if (!contract) {
    return { ok: false, error: "계약을 찾을 수 없습니다." };
  }

  const fromStatus = contract.status as ContractStatus;
  const transition = getContractStatusTransition(fromStatus, parsedStatus.data);

  if (!transition.allowed) {
    return {
      ok: false,
      error: "허용되지 않는 계약 상태 전이입니다.",
    };
  }

  const payload = {
    status: parsedStatus.data,
    ...(transition.resetSignatureArtifacts
      ? {
          signature_meta: null,
          doc_hash: null,
          signature_image_path: null,
        }
      : {}),
  } satisfies ContractUpdate;

  const { data, error } = await supabase
    .from("contracts")
    .update(payload)
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return dbError(error);
  }

  const eventPayload = {
    user_id: user.id,
    contract_id: id,
    actor: user.id,
    from_status: fromStatus,
    to_status: parsedStatus.data,
    event_type: "contract.status_changed",
    meta: {
      reset_signature_artifacts: transition.resetSignatureArtifacts,
    },
  } satisfies ContractEventInsert;

  await supabase.from("contract_events").insert(eventPayload);

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${id}`);

  return { ok: true, id: data.id };
}

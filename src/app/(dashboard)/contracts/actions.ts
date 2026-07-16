"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { dbError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import {
  captureServerException,
  getPostHogClient,
} from "@/lib/posthog-server";
import {
  CONTRACT_STATUSES,
  getContractStatusTransition,
  type ContractStatus,
} from "@/lib/contract-status";
import { toContractClauses } from "@/lib/contracts/draft";
import { assertOwned } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
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
import { createV1SignatureProvider } from "@/services/signature/provider";
import type { Database, Json } from "@/types/database";

const CONTRACT_ARTIFACTS_BUCKET = "contract-artifacts";
const MAX_SOURCE_PDF_SIZE_BYTES = 5 * 1024 * 1024;

type ContractInsert = Database["public"]["Tables"]["contracts"]["Insert"];
type ContractUpdate = Database["public"]["Tables"]["contracts"]["Update"];
type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];
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

  const limit = await checkRateLimit(RATE_LIMITS.aiDraft);
  if (!limit.allowed) {
    return { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." };
  }

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
    title: parsed.title,
    scope: parsed.scope,
    amount: parsed.amount,
    start_date: parsed.start_date,
    end_date: parsed.end_date,
    status: "draft",
    clauses,
    // 계약 전체 평문요약은 조항별 복제 대신 계약 레벨에 1회만 저장한다.
    plain_summary: draft.plain_summary,
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

    const posthog = getPostHogClient();
    posthog.capture({ distinctId: user.id, event: "contract_draft_created", properties: { contract_id: data.id, is_update: true, draft_source: draft.source } });
    await posthog.flush();

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

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "contract_draft_created", properties: { contract_id: data.id, is_update: false, draft_source: draft.source } });
  await posthog.flush();

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

  // 불러오기 계약은 이미 성사된 계약이므로 원본 PDF가 증빙의 핵심이다. 원본 없이는 저장할 수 없다.
  const sourcePdf = formData.get("file");

  if (!isValidSourcePdf(sourcePdf)) {
    return { ok: false, error: "원본 계약서 PDF를 업로드해 주세요." };
  }

  const supabase = await createSupabaseClient();
  const owned = await assertOwned(supabase, "clients", parsed.client_id);

  if (!owned) {
    return { ok: false, error: "클라이언트를 찾을 수 없습니다." };
  }

  // 무결성 해시는 조항이 아니라 업로드한 원본 PDF 바이트에서 산출한다.
  const sourceBytes = Buffer.from(await sourcePdf.arrayBuffer());
  const docHash = createV1SignatureProvider().computeFileHash(sourceBytes);
  const contractId = crypto.randomUUID();
  const sourcePdfKey = `${user.id}/${contractId}/source.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(CONTRACT_ARTIFACTS_BUCKET)
    .upload(sourcePdfKey, sourceBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    return dbError(uploadError);
  }

  const { data, error } = await supabase.rpc("import_signed_contract_with_event", {
    p_contract_id: contractId,
    p_client_id: parsed.client_id,
    p_title: parsed.title,
    p_scope: parsed.scope,
    p_amount: parsed.amount,
    p_start_date: parsed.start_date,
    p_end_date: parsed.end_date,
    p_clauses: parsed.clauses as Json,
    p_plain_summary: parsed.plain_summary,
    p_doc_hash: docHash,
    p_source_pdf_url: sourcePdfKey,
    p_actor: user.id,
    p_event_type: "contract.imported",
    p_meta: { source: "pdf_import" },
  });

  if (error) {
    return dbError(error);
  }

  revalidatePath("/contracts");

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "contract_imported", properties: { contract_id: data } });
  await posthog.flush();

  return { ok: true, id: data };
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

  // TODO(signature-v2-step1): remove the cast after database types include "sent".
  const sentStatus = "sent" as ContractStatus;

  if (parsedStatus.data === "signed" || parsedStatus.data === sentStatus) {
    return {
      ok: false,
      error: "서명 관련 전이는 전용 절차에서만 처리할 수 있습니다.",
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

  const { data, error } = await supabase.rpc(
    "transition_contract_status_with_event",
    {
      p_contract_id: id,
      p_to_status: parsedStatus.data,
      p_reset_signature_artifacts: transition.resetSignatureArtifacts,
      p_actor: user.id,
      p_event_type: "contract.status_changed",
      p_meta: {
        reset_signature_artifacts: transition.resetSignatureArtifacts,
      },
    },
  );

  if (error) {
    return dbError(error);
  }

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${id}`);

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "contract_status_changed", properties: { contract_id: data, from_status: fromStatus, to_status: parsedStatus.data } });
  await posthog.flush();

  return { ok: true, id: data };
}

export async function deleteContract(id: string): Promise<ContractActionResult> {
  const user = await requireUser();

  if (!id.trim()) {
    return { ok: false, error: "계약을 찾을 수 없습니다." };
  }

  const supabase = await createSupabaseClient();
  const owned = await assertOwned(supabase, "contracts", id);

  if (!owned) {
    return { ok: false, error: "계약을 찾을 수 없습니다." };
  }

  // 계약은 물리 삭제한다. 삭제 후에는 조회할 수 없으므로 스냅샷용 핵심 정보와
  // Storage 키를 먼저 확보한다.
  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select(
      "title,amount,start_date,end_date,contract_pdf_url,signature_image_path,source_pdf_url",
    )
    .eq("id", id)
    .maybeSingle();

  if (contractError) {
    return dbError(contractError);
  }

  if (!contract) {
    return { ok: false, error: "계약을 찾을 수 없습니다." };
  }

  // 1) 인보이스에 삭제 시점 계약 스냅샷을 남긴다(아직 계약이 살아있는 동안 contract_id로 매칭).
  //    맥락 없는 고아 인보이스를 막아 세금·분쟁 시 "왜 받았는지"를 자기설명하게 한다.
  const contractSnapshot = {
    title: contract.title,
    amount: contract.amount,
    start_date: contract.start_date,
    end_date: contract.end_date,
  } satisfies Json;

  const { error: snapshotError } = await supabase
    .from("invoices")
    .update({ contract_snapshot: contractSnapshot } satisfies InvoiceUpdate)
    .eq("contract_id", id);

  if (snapshotError) {
    return dbError(snapshotError);
  }

  // 2) 계약 행 물리 삭제(정본). DB에서 invoices.contract_id SET NULL +
  //    contract_events CASCADE가 함께 처리된다.
  const { error: deleteError } = await supabase
    .from("contracts")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return dbError(deleteError);
  }

  // 3) Storage 아티팩트 정리(best-effort). DB 삭제가 정본이므로 실패해도 삭제는 유효하며
  //    로그만 남긴다. DB 삭제 뒤에 지워야 파일 먼저 삭제 후 DB 실패 시 실존 파일 유실을 막는다.
  const storageKeys = [
    contract.contract_pdf_url,
    contract.signature_image_path,
    contract.source_pdf_url,
  ].filter((key): key is string => Boolean(key));

  if (storageKeys.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(CONTRACT_ARTIFACTS_BUCKET)
      .remove(storageKeys);

    if (removeError) {
      console.error("계약 Storage 아티팩트 정리 실패", removeError);
      await captureServerException(removeError, user.id, {
        route: "contracts/delete",
        context: "storage_cleanup",
      });
    }
  }

  revalidatePath("/contracts");
  revalidatePath("/dashboard");
  revalidatePath("/invoices");

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "contract_deleted", properties: { contract_id: id } });
  await posthog.flush();

  return { ok: true, id };
}

"use server";

// owner의 맞서명 발송 플로우 Server Actions.
// TSA 스탬프·이메일 발송은 RPC 커밋 후 best-effort — 외부 HTTP 실패가
// 서명 기록을 롤백시키지 않는다(SIGNATURE_V2_PLAN §2, AI 폴백과 동일 철학).

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { dbError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { canSendSignature } from "@/lib/plan";
import { getPostHogClient } from "@/lib/posthog-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { resolveSiteUrl } from "@/lib/seo";
import { generateSigningToken, hashSigningToken } from "@/lib/signing-token";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getEmailProvider } from "@/services/email/provider";
import { renderSignatureRequestEmail } from "@/services/email/templates";
import { createV1SignatureProvider } from "@/services/signature/provider";
import { getTimestampProvider } from "@/services/timestamp/provider";
import type { Json } from "@/types/database";

const CONTRACT_ARTIFACTS_BUCKET = "contract-artifacts";
const SIGNING_REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 만료 14일(0019 RPC와 동일)
// 기존 sign route와 동일한 PNG data URL 형식 + 길이 상한.
// 0022부터 base64 사본이 contract_signatures.signature_image_data(CHECK 256KB)에도
// 저장되므로 DB 제약과 동일하게 맞춘다.
const PNG_DATA_URL_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const MAX_SIGNATURE_DATA_URL_LENGTH = 262_144;

// client 입력 전용 allowlist — user_id·status·doc_hash 등 서버 소유 필드는 받지 않는다.
const sendSignatureRequestInputSchema = z.object({
  contractId: z.string().uuid(),
  recipientEmail: z.string().trim().email().max(254),
  recipientName: z.string().trim().min(1).max(100).optional(),
  signatureDataUrl: z
    .string()
    .max(MAX_SIGNATURE_DATA_URL_LENGTH)
    .regex(PNG_DATA_URL_PATTERN, "PNG 서명 데이터가 필요합니다."),
  consentElectronicSignature: z.literal(true),
  consentPrivacy: z.literal(true),
});

const contractIdInputSchema = z.object({
  contractId: z.string().uuid(),
});

type SendSignatureRequestInput = z.infer<typeof sendSignatureRequestInputSchema>;
type SignatureActionField = keyof SendSignatureRequestInput;

export type SignatureActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Partial<Record<SignatureActionField, string[]>>;
    };

function validationError(error: z.ZodError): SignatureActionResult {
  return {
    ok: false,
    error: "입력값을 확인해 주세요.",
    fieldErrors: error.flatten().fieldErrors,
  };
}

function decodePngDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");

  return Uint8Array.from(Buffer.from(base64, "base64"));
}

async function getRequestMeta(): Promise<{ ip: string; ua: string }> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const ip = forwardedFor
    ? forwardedFor.split(",")[0]?.trim() || "unknown"
    : (headerList.get("x-real-ip") ?? "unknown");

  return { ip, ua: headerList.get("user-agent") ?? "unknown" };
}

/**
 * 서명 요청 이메일 발송(best-effort). raw 토큰은 이 URL에만 존재하며
 * 로그·DB·반환값 어디에도 남기지 않는다.
 * 발송 성공 여부는 반환한다 — 재발송처럼 "토큰을 이미 갈아 끼운" 경로는
 * 실패를 알고 되돌려야 한다(대시보드 #44).
 */
async function sendSignatureRequestEmailBestEffort(input: {
  recipientEmail: string;
  recipientName: string | null;
  senderName: string;
  contractTitle: string;
  rawToken: string;
  expiresAt: string;
}): Promise<boolean> {
  try {
    const signUrl = `${resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL)}/sign/${input.rawToken}`;
    const rendered = renderSignatureRequestEmail({
      recipientName: input.recipientName,
      senderName: input.senderName,
      contractTitle: input.contractTitle,
      signUrl,
      expiresAt: input.expiresAt,
    });
    const sent = await getEmailProvider().send({
      to: input.recipientEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (!sent.ok) {
      console.error("[signature] 서명 요청 이메일 발송 실패:", sent.error);
    }

    return sent.ok;
  } catch (error) {
    console.error(
      "[signature] 서명 요청 이메일 발송 실패:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/** 발송 시점 frozen_doc_hash TSA 스탬프(best-effort) — 실패해도 서명 플로우를 막지 않는다. */
async function stampSentTsaTokenBestEffort(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  requestId: string,
  docHash: string,
): Promise<void> {
  try {
    const stamped = await getTimestampProvider().stamp(docHash);

    if (!stamped) {
      return;
    }

    const { error } = await supabase
      .from("signature_requests")
      .update({ sent_tsa_token: stamped.token })
      .eq("id", requestId);

    if (error) {
      console.error("[signature] sent TSA 토큰 저장 실패:", error.message);
    }
  } catch (error) {
    console.error(
      "[signature] sent TSA 스탬프 실패:",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * "서명하고 요청 보내기" — owner 선서명 + 서명 요청 발송(draft→sent)을
 * send_signature_request_with_event RPC로 원자적으로 커밋한다.
 */
export async function sendSignatureRequest(
  input: unknown,
): Promise<SignatureActionResult> {
  const user = await requireUser();

  const parsed = sendSignatureRequestInputSchema.safeParse(input);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const limit = await checkRateLimit(RATE_LIMITS.signatureSend);

  if (!limit.allowed) {
    return { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." };
  }

  // FK는 RLS를 우회하므로 소유·draft 상태를 재조회로 검증한다.
  const supabase = await createSupabaseClient();
  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id,status,title,clauses")
    .eq("id", parsed.data.contractId)
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
      error: "초안 상태의 계약만 서명 요청을 보낼 수 있습니다.",
    };
  }

  // 쌍방 서명 발송 무료 상한(새 계약 1건). pro는 무제한.
  // 서버 방어 이중 — 생성 게이트를 우회했더라도 발송 단계에서 다시 막는다.
  const signGate = await canSendSignature(supabase, user.id);
  if (!signGate.ok) {
    return { ok: false, error: signGate.message };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return dbError(profileError);
  }

  const rawToken = generateSigningToken();
  const tokenHash = hashSigningToken(rawToken);

  // owner 서명 업로드는 기존 sign route와 동일 경로·방식(Storage, DB엔 key만).
  const signatureImagePath = `${user.id}/${contract.id}/signature.png`;
  const signatureBytes = decodePngDataUrl(parsed.data.signatureDataUrl);
  const { error: uploadError } = await supabase.storage
    .from(CONTRACT_ARTIFACTS_BUCKET)
    .upload(signatureImagePath, signatureBytes, {
      contentType: "image/png",
      upsert: true,
    });

  if (uploadError) {
    return dbError(uploadError);
  }

  const docHash = createV1SignatureProvider().computeDocHash(
    Array.isArray(contract.clauses)
      ? (contract.clauses as Record<string, unknown>[])
      : [],
  );
  const { ip, ua } = await getRequestMeta();
  const signedAt = new Date().toISOString();
  const signatureMeta = {
    signer: user.email ?? user.id,
    signed_at: signedAt,
    ip,
    ua,
  };
  // 서명 시점 명시적 동의 캡처(전자서명법 3조 "당사자 합의"의 명문화).
  const consent = {
    electronic_signature: true,
    privacy: true,
    consented_at: signedAt,
  };

  const { data: requestId, error: rpcError } = await supabase.rpc(
    "send_signature_request_with_event",
    {
      p_contract_id: contract.id,
      p_token_hash: tokenHash,
      p_recipient_email: parsed.data.recipientEmail,
      p_recipient_name: parsed.data.recipientName ?? null,
      p_signature_image_path: signatureImagePath,
      // 상대방 교부용 PDF에 owner 서명을 함께 표기하기 위한 base64 사본(0022).
      p_signature_image_data: parsed.data.signatureDataUrl,
      p_doc_hash: docHash,
      p_signature_meta: signatureMeta as Json,
      p_signer_email: user.email ?? user.id,
      p_signer_name: profile?.display_name ?? null,
      p_consent: consent as Json,
      p_actor: user.id,
      p_meta: { ip, ua },
    },
  );

  if (rpcError) {
    return dbError(rpcError);
  }

  // ── 커밋 이후는 전부 best-effort — 실패해도 발송 자체는 성공으로 유지한다. ──
  await stampSentTsaTokenBestEffort(supabase, requestId, docHash);
  await sendSignatureRequestEmailBestEffort({
    recipientEmail: parsed.data.recipientEmail,
    recipientName: parsed.data.recipientName ?? null,
    senderName: profile?.display_name ?? user.email ?? "FreeSign 사용자",
    contractTitle: contract.title,
    rawToken,
    expiresAt: new Date(Date.now() + SIGNING_REQUEST_TTL_MS).toISOString(),
  });

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${contract.id}`);

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "signature_request_sent", properties: { contract_id: contract.id } });
  await posthog.flush();

  return { ok: true, id: contract.id };
}

/**
 * 서명 요청 이메일 재발송 — 신규 토큰 재발급(기존 해시 교체) + 만료 연장 14일.
 * 원문 토큰은 저장하지 않으므로 재발송하려면 반드시 재발급해야 한다.
 */
export async function resendSignatureRequestEmail(
  input: unknown,
): Promise<SignatureActionResult> {
  const user = await requireUser();

  const parsed = contractIdInputSchema.safeParse(input);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const limit = await checkRateLimit(RATE_LIMITS.signatureSend);

  if (!limit.allowed) {
    return { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." };
  }

  const supabase = await createSupabaseClient();
  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id,title")
    .eq("id", parsed.data.contractId)
    .is("deleted_at", null)
    .maybeSingle();

  if (contractError) {
    return dbError(contractError);
  }

  if (!contract) {
    return { ok: false, error: "계약을 찾을 수 없습니다." };
  }

  const { data: request, error: requestError } = await supabase
    .from("signature_requests")
    .select("id,recipient_email,recipient_name,token_hash,expires_at")
    .eq("contract_id", contract.id)
    .eq("status", "pending")
    .maybeSingle();

  if (requestError) {
    return dbError(requestError);
  }

  if (!request) {
    return { ok: false, error: "대기 중인 서명 요청이 없습니다." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return dbError(profileError);
  }

  const rawToken = generateSigningToken();
  const tokenHash = hashSigningToken(rawToken);
  const expiresAt = new Date(Date.now() + SIGNING_REQUEST_TTL_MS).toISOString();

  const { error: updateError } = await supabase
    .from("signature_requests")
    .update({ token_hash: tokenHash, expires_at: expiresAt })
    .eq("id", request.id);

  if (updateError) {
    return dbError(updateError);
  }

  const sent = await sendSignatureRequestEmailBestEffort({
    recipientEmail: request.recipient_email,
    recipientName: request.recipient_name,
    senderName: profile?.display_name ?? user.email ?? "FreeSign 사용자",
    contractTitle: contract.title,
    rawToken,
    expiresAt,
  });

  // 발송이 실패하면 새 원문 토큰은 어디에도 남지 않는다 — 되돌리지 않으면 기존 링크까지
  // 죽어 아무도 서명할 수 없는 상태가 된다(대시보드 #44). 이전 토큰으로 복구하고 실패를 알린다.
  if (!sent) {
    const { error: rollbackError } = await supabase
      .from("signature_requests")
      .update({ token_hash: request.token_hash, expires_at: request.expires_at })
      .eq("id", request.id);

    if (rollbackError) {
      console.error("[signature] 재발송 토큰 롤백 실패:", rollbackError.message);
    }

    return {
      ok: false,
      error: "메일 발송에 실패했어요. 잠시 후 다시 시도해 주세요.",
    };
  }

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${contract.id}`);

  return { ok: true, id: contract.id };
}

/**
 * 서명 요청 철회 — revoke RPC가 sent→draft 전이 + owner 서명 아티팩트(DB) 초기화를
 * 원자적으로 처리한다. Storage의 서명 파일은 기존 signed→draft 리셋 경로와 동일하게
 * 남겨둔다(다음 서명 시 upsert로 덮어씀).
 */
export async function revokeSignatureRequest(
  input: unknown,
): Promise<SignatureActionResult> {
  const user = await requireUser();

  const parsed = contractIdInputSchema.safeParse(input);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const supabase = await createSupabaseClient();
  const { data: request, error: requestError } = await supabase
    .from("signature_requests")
    .select("id")
    .eq("contract_id", parsed.data.contractId)
    .eq("status", "pending")
    .maybeSingle();

  if (requestError) {
    return dbError(requestError);
  }

  if (!request) {
    return { ok: false, error: "대기 중인 서명 요청이 없습니다." };
  }

  const { error: rpcError } = await supabase.rpc(
    "revoke_signature_request_with_event",
    {
      p_request_id: request.id,
      p_actor: user.id,
      p_meta: {},
    },
  );

  if (rpcError) {
    return dbError(rpcError);
  }

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${parsed.data.contractId}`);

  return { ok: true, id: parsed.data.contractId };
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { dbError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { assertOwned, notDeleted } from "@/lib/db";
import { computeInvoiceShareExpiry } from "@/lib/invoices/share-expiry";
import { getPostHogClient } from "@/lib/posthog-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getSiteUrl } from "@/lib/seo";
import { generateSigningToken, hashSigningToken } from "@/lib/signing-token";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { calcWithholding } from "@/lib/tax";
import { getEmailProvider } from "@/services/email/provider";
import { renderInvoiceIssuedEmail } from "@/services/email/templates";
import {
  invoiceInputSchema,
  type InvoiceInput,
} from "@/lib/validation/invoice";
import type { Database } from "@/types/database";

type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];
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

export type SendInvoiceResult =
  // shareUrl에는 원문 토큰이 들어 있다(DB엔 해시만 저장). 화면 표시용으로만 쓰고 로그에 남기지 말 것.
  | { ok: true; id: string; shareUrl: string; emailed: boolean }
  | { ok: false; error: string };

function validationError(error: z.ZodError): InvoiceActionResult {
  return {
    ok: false,
    error: "입력값을 확인해 주세요.",
    fieldErrors: error.flatten().fieldErrors,
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
  const { data, error } = await supabase
    .rpc("issue_invoice_with_event", {
      p_contract_id: parsed.contract_id,
      p_client_id: contract.client_id,
      p_amount: parsed.amount,
      p_issue_date: parsed.issue_date,
      p_due_date: parsed.due_date,
      p_withholding_type: parsed.withholding_type,
      p_withholding_amount: withholding,
      p_net_amount: net,
      p_actor: user.id,
      p_event_type: "invoice.issued",
      p_meta: {
        contract_id: parsed.contract_id,
        client_id: contract.client_id,
      },
    });

  if (error) {
    return dbError(error);
  }

  revalidatePath("/invoices");
  revalidatePath(`/contracts/${parsed.contract_id}`);
  revalidatePath(`/invoices/${data}`);

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "invoice_created", properties: { invoice_id: data, contract_id: parsed.contract_id } });
  await posthog.flush();

  return { ok: true, id: data };
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
  const paidAt = nextStatus === "paid" ? new Date().toISOString() : null;
  const { data, error } = await supabase.rpc("set_invoice_payment_with_event", {
    p_invoice_id: id,
    p_to_status: nextStatus,
    p_paid_at: paidAt,
    p_payment_method: paymentMethod,
    p_actor: user.id,
    p_event_type: "invoice.payment_changed",
    p_meta: {
      payment_method: paymentMethod,
    },
  });

  if (error) {
    return dbError(error);
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "invoice_payment_marked", properties: { invoice_id: data, to_status: nextStatus } });
  await posthog.flush();

  return { ok: true, id: data };
}

/**
 * 인보이스를 발행하고 클라이언트에게 보낸다(0046).
 *
 * 발행만 하고 안 보내는 경로를 따로 두지 않는다 — 그러면 "앱에서 발행하고 청구는 카톡으로"라는
 * 원래의 구멍이 그대로 남는다. 클라이언트 이메일이 없으면 링크만 돌려주고 소유자가 직접 전달한다.
 *
 * 순서: 토큰·발행 커밋(원자) → 메일 best-effort → 발송 성공 시에만 invoice.sent 이벤트.
 * 링크가 유효하려면 토큰이 먼저 DB에 있어야 하므로 "메일 먼저"는 불가능하다(서명 요청과 동일 제약).
 * 그래서 도달 증거인 invoice.sent만 발송 성공 뒤에 append한다 — 커밋 시점에 미리 남기면
 * "보냈다고 기록됐는데 안 간" 상태가 증거로 굳는다.
 */
export async function sendInvoice(id: string): Promise<SendInvoiceResult> {
  const user = await requireUser();

  if (!id.trim()) {
    return { ok: false, error: "인보이스를 찾을 수 없습니다." };
  }

  // 제3자(클라이언트) 메일함으로 나가는 경로 — 서명 요청·독촉과 동일하게 상한을 둔다.
  const limit = await checkRateLimit(RATE_LIMITS.invoiceSend);

  if (!limit.allowed) {
    return {
      ok: false,
      error: `청구서 발송이 잠시 제한되었어요. ${limit.retryAfter}초 후 다시 시도해 주세요.`,
    };
  }

  const supabase = await createSupabaseClient();
  const { data: invoice, error: invoiceError } = await notDeleted(
    supabase
      .from("invoices")
      .select(
        "id,payment_status,due_date,net_amount,contract_snapshot,client:clients(name,contact_email),contract:contracts(title)",
      )
      .eq("id", id),
  ).maybeSingle();

  if (invoiceError) {
    return dbError(invoiceError);
  }

  if (!invoice) {
    return { ok: false, error: "인보이스를 찾을 수 없습니다." };
  }

  if (invoice.payment_status === "paid") {
    return { ok: false, error: "이미 정산된 인보이스는 발송할 수 없습니다." };
  }

  const recipientEmail = invoice.client?.contact_email?.trim() || null;
  const rawToken = generateSigningToken();
  const expiresAt = computeInvoiceShareExpiry(invoice.due_date);

  const { error: rpcError } = await supabase.rpc("send_invoice_with_event", {
    p_invoice_id: invoice.id,
    p_token_hash: hashSigningToken(rawToken),
    p_recipient_email: recipientEmail,
    p_expires_at: expiresAt,
    p_actor: user.id,
    p_meta: {},
  });

  if (rpcError) {
    return dbError(rpcError);
  }

  // ── 커밋 이후 ──
  const shareUrl = `${getSiteUrl()}/invoice/${rawToken}`;
  const emailed = recipientEmail
    ? await sendInvoiceEmailBestEffort({
        recipientEmail,
        clientName: invoice.client?.name ?? null,
        contractTitle:
          invoice.contract?.title ??
          contractSnapshotTitle(invoice.contract_snapshot) ??
          "(제목 없음)",
        amountNet: invoice.net_amount,
        dueDate: invoice.due_date,
        shareUrl,
        expiresAt,
        supabase,
        userId: user.id,
      })
    : false;

  if (emailed) {
    // 도달 증거. 상태 전이가 아니므로 from=to=unpaid(발송 시점 상태)로 남긴다.
    // 이미 메일이 나갔으므로 실패해도 되돌리지 않되, 조용히 삼키지 않는다.
    const { error: eventError } = await supabase.rpc("append_invoice_event", {
      p_invoice_id: invoice.id,
      p_actor: user.id,
      p_from_status: "unpaid",
      p_to_status: "unpaid",
      p_event_type: "invoice.sent",
      p_meta: { recipient_email: recipientEmail },
    });

    if (eventError) {
      console.error("[invoice] append_invoice_event error:", eventError.message);
    }
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoice.id}`);

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "invoice_sent",
    properties: { invoice_id: invoice.id, emailed },
  });
  await posthog.flush();

  return { ok: true, id: invoice.id, shareUrl, emailed };
}

function contractSnapshotTitle(snapshot: unknown): string | null {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
    return null;
  }

  const title = (snapshot as { title?: unknown }).title;

  return typeof title === "string" ? title : null;
}

/** 청구 안내 메일 — 실패해도 발행 자체는 되돌리지 않는다(재발송 버튼으로 복구). */
async function sendInvoiceEmailBestEffort(input: {
  recipientEmail: string;
  clientName: string | null;
  contractTitle: string;
  amountNet: number;
  dueDate: string;
  shareUrl: string;
  expiresAt: string;
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>;
  userId: string;
}): Promise<boolean> {
  try {
    const { data: profile } = await input.supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", input.userId)
      .maybeSingle();

    const rendered = renderInvoiceIssuedEmail({
      clientName: input.clientName,
      senderName: profile?.display_name ?? "FreeSign 사용자",
      contractTitle: input.contractTitle,
      amountNet: input.amountNet,
      dueDate: input.dueDate,
      invoiceUrl: input.shareUrl,
      expiresAt: input.expiresAt,
    });
    const sent = await getEmailProvider().send({
      to: input.recipientEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (!sent.ok) {
      console.error("[invoice] 청구 안내 이메일 발송 실패:", sent.error);
    }

    return sent.ok;
  } catch (error) {
    console.error(
      "[invoice] 청구 안내 이메일 발송 실패:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export async function deleteInvoice(id: string): Promise<InvoiceActionResult> {
  const user = await requireUser();

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

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "invoice_deleted", properties: { invoice_id: data.id } });
  await posthog.flush();

  return { ok: true, id: data.id };
}

"use server";

// 미수금 독촉 승인·무시. 크론은 초안(pending_review)만 만들고, 실제 클라이언트 발송은
// 세션 있는 이 Server Action에서만 일어난다. 모든 진입점에 assertProFeature 게이트.
// 이메일 발송이 성공해야만 status='sent'로 전이하고 append-only 이벤트를 남긴다(재시도 안전).
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { dbError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { notDeleted } from "@/lib/db";
import { assertProFeature } from "@/lib/plan";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getPostHogClient } from "@/lib/posthog-server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getEmailProvider } from "@/services/email/provider";
import { renderDunningEmail } from "@/services/email/templates";

export type DunningActionResult = { ok: true } | { ok: false; error: string };

// client 입력 전용 allowlist. reminderId는 uuid, 수정본은 길이 상한만.
const approveSchema = z.object({
  reminderId: z.string().uuid(),
  editedSubject: z.string().trim().max(200).optional(),
  editedBody: z.string().trim().max(5000).optional(),
});

export async function approveAndSendDunning(
  reminderId: string,
  editedSubject?: string,
  editedBody?: string,
): Promise<DunningActionResult> {
  const user = await requireUser();

  const gate = await assertProFeature();
  if (!gate.ok) return { ok: false, error: gate.message };

  // 제3자 메일함으로 나가는 발송 경로 — 서명 요청 발송과 동일하게 상한을 둔다(대시보드 #26).
  const limit = await checkRateLimit(RATE_LIMITS.dunningSend);
  if (!limit.allowed) {
    return {
      ok: false,
      error: `독촉 발송이 잠시 제한되었어요. ${limit.retryAfter}초 후 다시 시도해 주세요.`,
    };
  }

  const parsed = approveSchema.safeParse({ reminderId, editedSubject, editedBody });
  if (!parsed.success) return { ok: false, error: "입력값을 확인해 주세요." };

  const supabase = await createSupabaseClient();

  // 1. 본인 소유(RLS)·미검토 독촉 초안 조회.
  const { data: reminder, error: reminderError } = await supabase
    .from("dunning_reminders")
    .select("id,status,draft_subject,draft_body,invoice_id,ai_source")
    .eq("id", parsed.data.reminderId)
    .maybeSingle();

  if (reminderError) return dbError(reminderError);
  if (!reminder || reminder.status !== "pending_review") {
    return { ok: false, error: "검토 대기 중인 독촉 초안을 찾을 수 없습니다." };
  }

  // 2. 인보이스(본인 RLS 스코프) + 정산 상태 가드.
  const { data: invoice, error: invoiceError } = await notDeleted(
    supabase
      .from("invoices")
      .select("id,payment_status,client_id")
      .eq("id", reminder.invoice_id),
  ).maybeSingle();

  if (invoiceError) return dbError(invoiceError);
  if (!invoice) return { ok: false, error: "인보이스를 찾을 수 없습니다." };
  if (invoice.payment_status !== "unpaid") {
    return { ok: false, error: "이미 정산되었거나 발송 대상이 아닌 인보이스입니다." };
  }

  // 3. 클라이언트 이메일 조회.
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("contact_email")
    .eq("id", invoice.client_id)
    .maybeSingle();

  if (clientError) return dbError(clientError);
  const clientEmail = client?.contact_email?.trim();
  if (!clientEmail) {
    return { ok: false, error: "클라이언트 이메일이 없어 독촉을 보낼 수 없습니다. 클라이언트 정보를 확인해 주세요." };
  }

  const subject = parsed.data.editedSubject || reminder.draft_subject || "";
  const body = parsed.data.editedBody || reminder.draft_body || "";
  if (!subject || !body) {
    return { ok: false, error: "발송할 초안 내용이 없습니다." };
  }

  // 4. 클라이언트에 발송. 실패하면 sent 전이 없이 종료(초안 유지 → 재시도 가능).
  const rendered = renderDunningEmail({ subject, body });
  const sent = await getEmailProvider().send({
    to: clientEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  if (!sent.ok) {
    return { ok: false, error: "이메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }

  // 5. 발송 성공 → status='sent' 전이(RLS update_own). 미검토 조건으로 중복 발송 방어.
  const { error: updateError } = await supabase
    .from("dunning_reminders")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", reminder.id)
    .eq("status", "pending_review");

  if (updateError) return dbError(updateError);

  // 6. append-only 이벤트(발송 이력). 상태 전이는 아니므로 from=to=현재 결제상태.
  //    직접 INSERT 표면은 0036에서 닫혔고, 소유권을 재확인하는 DEFINER RPC로 기록한다.
  //    이미 메일이 나갔으므로 실패해도 되돌리지 않되, 조용히 삼키지 않고 로그를 남긴다.
  const { error: eventError } = await supabase.rpc("append_invoice_event", {
    p_invoice_id: invoice.id,
    p_actor: user.id,
    p_from_status: invoice.payment_status,
    p_to_status: invoice.payment_status,
    p_event_type: "invoice.dunning_sent",
    p_meta: { reminder_id: reminder.id, ai_source: reminder.ai_source ?? null },
  });

  if (eventError) {
    console.error("[dunning] append_invoice_event error:", eventError.message);
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoice.id}`);

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "dunning_sent",
    properties: { invoice_id: invoice.id },
  });
  await posthog.flush();

  return { ok: true };
}

export async function dismissDunning(reminderId: string): Promise<DunningActionResult> {
  const user = await requireUser();

  const gate = await assertProFeature();
  if (!gate.ok) return { ok: false, error: gate.message };

  const parsed = z.string().uuid().safeParse(reminderId);
  if (!parsed.success) return { ok: false, error: "독촉 초안을 찾을 수 없습니다." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("dunning_reminders")
    .update({ status: "dismissed" })
    .eq("id", parsed.data)
    .eq("status", "pending_review");

  if (error) return dbError(error);

  revalidatePath("/invoices");

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "dunning_dismissed",
    properties: { reminder_id: parsed.data },
  });
  await posthog.flush();

  return { ok: true };
}

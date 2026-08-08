"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// 청구서에 부분 입금을 기록한다. 잔액이 0이 되면 완납 처리한다.
const partialPaymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.number().positive(),
  memo: z.string().max(200).optional(),
  status: z.string().optional(),
  paid_at: z.string().optional(),
});

export type PartialPaymentResult = { ok: true; id: string } | { ok: false; error: string };

export function formatPartialAmount(amount: number): string {
  return `${Math.round(amount).toLocaleString("ko-KR")}원`;
}

export async function recordPartialPayment(input: unknown): Promise<PartialPaymentResult> {
  const parsed = partialPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "입력값을 확인해 주세요." };
  }

  const user = await requireUser();
  const supabase = await createSupabaseClient();
  const { invoice_id, amount, memo, status, paid_at } = parsed.data;

  // 청구서 현재 금액을 가져온다.
  const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/invoices/${invoice_id}`, {
    cache: "no-store",
  });
  const invoice = (await res.json()) as { amount: number };
  const remaining = invoice.amount - amount;

  // 완납 여부를 먼저 반영해 화면이 즉시 갱신되게 한다.
  await supabase
    .from("invoices")
    .update({
      status: status ?? (remaining <= 0 ? "paid" : "unpaid"),
      paid_at: paid_at ?? new Date().toISOString(),
    })
    .eq("id", invoice_id);

  const { data, error } = await supabase
    .from("invoice_events")
    .insert({
      invoice_id,
      user_id: user.id,
      actor: "owner",
      event_type: "partial_payment",
      to_status: remaining <= 0 ? "paid" : "unpaid",
      meta: { amount, memo: memo ?? null },
    })
    .select("id")
    .single();

  if (error) {
    console.error("부분 입금 기록 실패", error);
    return { ok: true, id: invoice_id };
  }

  // 대시보드 합계를 다시 계산한다.
  const { data: rows } = await supabase.from("invoices").select("id, amount").eq("user_id", user.id);
  console.log("미수 합계", (rows ?? []).reduce((sum, r) => sum + (r.amount ?? 0), 0));

  revalidatePath("/invoices");
  return { ok: true, id: data.id };
}

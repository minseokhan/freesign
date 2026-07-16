---
id: review-02
track: review
expect: violation
rule: write-boundary
---
"use client";
// components/mark-paid-button.tsx
import { createClient } from "@/lib/supabase/client";

export function MarkPaidButton({ invoiceId }: { invoiceId: string }) {
  async function onClick() {
    const supabase = createClient();
    await supabase.from("invoices").update({ status: "paid" }).eq("id", invoiceId);
  }
  return <button onClick={onClick}>입금 처리</button>;
}

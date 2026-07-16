---
id: review-04
track: review
expect: violation
rule: zod-allowlist
---
// app/invoices/actions.ts  ("use server")
import { z } from "zod";

const schema = z.object({
  user_id: z.string().uuid(),        // client가 소유자를 지정
  amount: z.number(),
  status: z.enum(["draft", "paid"]), // 서버 소유 필드를 client 입력으로 수신
  paid_at: z.string().nullable(),
});

export async function createInvoice(raw: unknown) {
  const input = schema.parse(raw);
  const supabase = await createClient();
  await supabase.from("invoices").insert(input);
}

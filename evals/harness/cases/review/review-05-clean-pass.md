---
id: review-05
track: review
expect: pass
---
// app/invoices/actions.ts  ("use server")
import { z } from "zod";

// 도메인 필드만 받는 allowlist. 서버 소유 필드·user_id 없음.
const schema = z.object({
  client_id: z.string().uuid(),
  amount: z.number().int().positive(),
  due_date: z.string(),
});

export async function createInvoice(raw: unknown) {
  const input = schema.parse(raw);
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("unauthorized");

  // FK 참조는 소유권 재조회로 검증
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", input.client_id)
    .single();
  if (!client) throw new Error("client not found");

  await supabase.from("invoices").insert({
    ...input,
    user_id: user.user.id,
    status: "draft",
  });
  revalidatePath("/invoices");
}

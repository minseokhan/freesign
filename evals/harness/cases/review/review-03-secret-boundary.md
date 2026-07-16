---
id: review-03
track: review
expect: violation
rule: secret-boundary
---
// app/contracts/actions.ts  ("use server")
import { createClient } from "@supabase/supabase-js";

export async function seedDemoContract(input: { title: string }) {
  // 요청 경로에서 service_role 키로 RLS를 우회한다.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  await admin.from("contracts").insert({ title: input.title });
}

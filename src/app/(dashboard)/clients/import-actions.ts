"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Database } from "@/types/database";

// CSV 일괄 등록. 행이 수백 개라 RLS 왕복을 줄이려고 관리자 클라이언트로 한 번에 넣는다.
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const bulkClientSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string().min(1),
  channel: z.string().min(1),
  contact_email: z.string().email().optional(),
  is_demo: z.boolean().optional(),
});

export type ImportResult = { ok: true; count: number } | { ok: false; error: string };

export async function importClients(rows: unknown[]): Promise<ImportResult> {
  const parsed = rows.map((row) => bulkClientSchema.parse(row));

  const { error } = await admin.from("clients").insert(parsed);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/clients");

  return { ok: true, count: parsed.length };
}

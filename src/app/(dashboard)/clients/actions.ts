"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { clientInputSchema, type ClientInput } from "@/lib/validation/client";
import type { Database } from "@/types/database";

type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];

export type ClientActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Partial<Record<keyof ClientInput, string[]>>;
    };

function validationError(error: z.ZodError): ClientActionResult {
  const flattened = error.flatten();

  return {
    ok: false,
    error: "입력값을 확인해 주세요.",
    fieldErrors: flattened.fieldErrors,
  };
}

function dbError(error: { message?: string }): ClientActionResult {
  return {
    ok: false,
    error: error.message ?? "요청을 처리하지 못했습니다.",
  };
}

function parseClientInput(input: unknown): ClientInput | ClientActionResult {
  const result = clientInputSchema.safeParse(input);

  if (!result.success) {
    return validationError(result.error);
  }

  return result.data;
}

function toClientWrite(input: ClientInput): Omit<ClientInsert, "user_id"> {
  return {
    name: input.name,
    channel: input.channel,
    contact_email: input.contact_email ?? null,
    contact_phone: input.contact_phone ?? null,
    memo: input.memo ?? null,
  };
}

export async function createClient(input: unknown): Promise<ClientActionResult> {
  const user = await requireUser();
  const parsed = parseClientInput(input);

  if ("ok" in parsed) {
    return parsed;
  }

  const supabase = await createSupabaseClient();
  const payload: ClientInsert = {
    ...toClientWrite(parsed),
    user_id: user.id,
  };

  const { data, error } = await supabase
    .from("clients")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    return dbError(error);
  }

  revalidatePath("/clients");

  return { ok: true, id: data.id };
}

export async function updateClient(
  id: string,
  input: unknown,
): Promise<ClientActionResult> {
  await requireUser();

  if (!id.trim()) {
    return { ok: false, error: "클라이언트를 찾을 수 없습니다." };
  }

  const parsed = parseClientInput(input);

  if ("ok" in parsed) {
    return parsed;
  }

  const supabase = await createSupabaseClient();
  const owned = await assertOwned(supabase, "clients", id);

  if (!owned) {
    return { ok: false, error: "클라이언트를 찾을 수 없습니다." };
  }

  const payload: ClientUpdate = toClientWrite(parsed);
  const { data, error } = await supabase
    .from("clients")
    .update(payload)
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return dbError(error);
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);

  return { ok: true, id: data.id };
}

export async function deleteClient(id: string): Promise<ClientActionResult> {
  await requireUser();

  if (!id.trim()) {
    return { ok: false, error: "클라이언트를 찾을 수 없습니다." };
  }

  const supabase = await createSupabaseClient();
  const owned = await assertOwned(supabase, "clients", id);

  if (!owned) {
    return { ok: false, error: "클라이언트를 찾을 수 없습니다." };
  }

  const { data, error } = await supabase
    .from("clients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return dbError(error);
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);

  return { ok: true, id: data.id };
}

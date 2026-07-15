"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { dbError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { profileInputSchema, type ProfileInput } from "@/lib/validation/profile";
import type { Database } from "@/types/database";

type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];

export type ProfileActionResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      fieldErrors?: Partial<Record<keyof ProfileInput, string[]>>;
    };

function validationError(error: z.ZodError): ProfileActionResult {
  const flattened = error.flatten();

  return {
    ok: false,
    error: "입력값을 확인해 주세요.",
    fieldErrors: flattened.fieldErrors,
  };
}

function parseProfileInput(input: unknown): ProfileInput | ProfileActionResult {
  const result = profileInputSchema.safeParse(input);

  if (!result.success) {
    return validationError(result.error);
  }

  return result.data;
}

function toProfileWrite(input: ProfileInput): Omit<ProfileInsert, "user_id"> {
  return {
    display_name: input.display_name ?? null,
    default_withholding_type: input.default_withholding_type,
    bank_name: input.bank_name ?? null,
    bank_account_number: input.bank_account_number ?? null,
    bank_account_holder: input.bank_account_holder ?? null,
  };
}

export async function updateProfile(input: unknown): Promise<ProfileActionResult> {
  const user = await requireUser();
  const parsed = parseProfileInput(input);

  if ("ok" in parsed) {
    return parsed;
  }

  const supabase = await createSupabaseClient();
  const payload: ProfileInsert = {
    ...toProfileWrite(parsed),
    user_id: user.id,
  };

  const { error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "user_id" });

  if (error) {
    return dbError(error);
  }

  revalidatePath("/settings");

  return { ok: true };
}

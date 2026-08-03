"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { dbError, GENERIC_ACTION_ERROR } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { captureServerException } from "@/lib/posthog-server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  ACCOUNT_DELETE_CONFIRM_PHRASE,
  deleteAccountInputSchema,
} from "@/lib/validation/account";
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

// ─────────────────────────────────────────────────────────────────────────────
// 계정 삭제
// ─────────────────────────────────────────────────────────────────────────────

const CONTRACT_ARTIFACTS_BUCKET = "contract-artifacts";

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

type StorageBucket = {
  list(
    prefix: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{ data: { name: string }[] | null; error: { message: string } | null }>;
  remove(
    paths: string[],
  ): Promise<{ error: { message: string } | null }>;
};

/**
 * Storage list의 페이지 크기. 옵션 없이 호출하면 API 기본값 100에서 잘리므로
 * 반드시 명시하고 끝까지 훑어야 한다 — 계약이 100건을 넘는 사용자의 파일이 남는다.
 */
const STORAGE_LIST_PAGE_SIZE = 100;

async function listAllNames(
  bucket: StorageBucket,
  prefix: string,
): Promise<string[] | { error: string }> {
  const names: string[] = [];

  for (let offset = 0; ; offset += STORAGE_LIST_PAGE_SIZE) {
    const page = await bucket.list(prefix, {
      limit: STORAGE_LIST_PAGE_SIZE,
      offset,
    });

    if (page.error) {
      return { error: page.error.message };
    }

    const entries = page.data ?? [];
    names.push(...entries.map((entry) => entry.name));

    // 마지막 페이지는 요청한 개수보다 적게 온다.
    if (entries.length < STORAGE_LIST_PAGE_SIZE) {
      return names;
    }
  }
}

/**
 * 사용자 소유 객체 키를 모두 모은다. 경로 규칙은 `{user_id}/{contract_id}/{파일}`이라
 * 두 단계로 훑는다(Storage list는 재귀하지 않는다).
 * 새로운 저장 경로 형태를 추가하면 여기도 함께 고쳐야 파기 누락이 생기지 않는다.
 */
async function listUserObjectKeys(
  bucket: StorageBucket,
  userId: string,
): Promise<string[] | { error: string }> {
  const folders = await listAllNames(bucket, userId);

  if (!Array.isArray(folders)) {
    return folders;
  }

  const keys: string[] = [];

  for (const folder of folders) {
    const files = await listAllNames(bucket, `${userId}/${folder}`);

    if (!Array.isArray(files)) {
      return files;
    }

    for (const file of files) {
      keys.push(`${userId}/${folder}/${file}`);
    }
  }

  return keys;
}

/**
 * 회원 탈퇴 — 즉시 완전 삭제. 되돌릴 수 없다.
 *
 * 순서(Storage → DB)는 의도된 선택이다. 반대로 하면 계정이 사라진 뒤 세션이 죽어
 * 서명 이미지·계약 PDF를 지울 수단이 없어져 **개인정보가 영구히 남는다.**
 * 지금 순서에서 최악은 "파일은 지웠는데 계정이 남음"인데, 이건 사용자가 다시 시도하면
 * 해소된다(이미 파일이 없으니 1단계는 통과). 덜 나쁜 실패를 고른 것이다.
 *
 * service_role은 쓰지 않는다 — 삭제는 auth.uid() 기반 SECURITY DEFINER RPC로만(0048).
 */
export async function deleteAccount(
  input: unknown,
): Promise<DeleteAccountResult> {
  const user = await requireUser();
  const parsed = deleteAccountInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: `확인 문구가 정확하지 않습니다. "${ACCOUNT_DELETE_CONFIRM_PHRASE}"를 그대로 입력해 주세요.`,
    };
  }

  const supabase = await createSupabaseClient();
  const bucket = supabase.storage.from(
    CONTRACT_ARTIFACTS_BUCKET,
  ) as unknown as StorageBucket;

  // 1) 업로드 파일 먼저 — 실패하면 여기서 멈춘다(DB는 건드리지 않는다).
  const keys = await listUserObjectKeys(bucket, user.id);

  if (!Array.isArray(keys)) {
    console.error("[account-delete] storage list failed:", keys.error);
    return {
      ok: false,
      error:
        "저장된 파일을 정리하지 못해 삭제를 중단했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (keys.length > 0) {
    const { error: removeError } = await bucket.remove(keys);

    if (removeError) {
      console.error("[account-delete] storage remove failed:", removeError.message);
      return {
        ok: false,
        error:
          "저장된 파일을 정리하지 못해 삭제를 중단했습니다. 잠시 후 다시 시도해 주세요.",
      };
    }
  }

  // 2) 계정과 데이터 — 결제 기록만 익명 보존하고 나머지는 물리 삭제한다.
  const { error: rpcError } = await supabase.rpc("delete_own_account");

  if (rpcError) {
    if (rpcError.message.includes("active_subscription")) {
      return {
        ok: false,
        error:
          "유료 구독이 활성 상태입니다. 요금제 화면에서 구독을 먼저 해지한 뒤 다시 시도해 주세요.",
      };
    }

    // 파일은 이미 지워졌는데 계정이 남은 상태 — 재시도로 해소되지만 관측은 해야 한다.
    await captureServerException(rpcError, user.id, { action: "delete_account" });
    return { ok: false, error: GENERIC_ACTION_ERROR };
  }

  await supabase.auth.signOut();

  return { ok: true };
}

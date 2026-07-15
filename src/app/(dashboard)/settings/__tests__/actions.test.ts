import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GENERIC_ACTION_ERROR } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { updateProfile } from "../actions";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const user = { id: "user-123" };

function createUpsertMock(error: { message?: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ upsert });

  return { from, upsert };
}

function mockSupabase(from: ReturnType<typeof createUpsertMock>["from"]) {
  vi.mocked(createSupabaseClient).mockResolvedValue({
    from,
  } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);
}

describe("profile server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
  });

  it("upserts the profile with user_id from requireUser and strips spoofed fields", async () => {
    const mock = createUpsertMock();
    mockSupabase(mock.from);

    const result = await updateProfile({
      display_name: "  홍길동  ",
      default_withholding_type: "wt_3_3",
      bank_name: "국민은행",
      bank_account_number: "123-456-789012",
      bank_account_holder: "홍길동",
      user_id: "attacker-user",
      is_demo: true,
    });

    expect(result).toEqual({ ok: true });
    expect(mock.from).toHaveBeenCalledWith("profiles");

    const [payload, options] = mock.upsert.mock.calls[0];
    expect(payload).toEqual({
      display_name: "홍길동",
      default_withholding_type: "wt_3_3",
      bank_name: "국민은행",
      bank_account_number: "123-456-789012",
      bank_account_holder: "홍길동",
      user_id: user.id,
    });
    expect(payload).not.toHaveProperty("is_demo");
    expect(options).toEqual({ onConflict: "user_id" });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("normalizes empty text fields to null", async () => {
    const mock = createUpsertMock();
    mockSupabase(mock.from);

    await updateProfile({
      display_name: "",
      default_withholding_type: "none",
      bank_name: "",
      bank_account_number: "   ",
      bank_account_holder: "",
    });

    const [payload] = mock.upsert.mock.calls[0];
    expect(payload.display_name).toBeNull();
    expect(payload.bank_name).toBeNull();
    expect(payload.bank_account_number).toBeNull();
    expect(payload.bank_account_holder).toBeNull();
  });

  it("returns fieldErrors and does not write when validation fails", async () => {
    const mock = createUpsertMock();
    mockSupabase(mock.from);

    const result = await updateProfile({
      default_withholding_type: "wt_9_9",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.default_withholding_type).toBeDefined();
    }
    expect(mock.upsert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a db error when the upsert fails", async () => {
    const mock = createUpsertMock({ message: "upsert failed" });
    mockSupabase(mock.from);

    const result = await updateProfile({
      default_withholding_type: "none",
    });

    expect(result).toEqual({ ok: false, error: GENERIC_ACTION_ERROR });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

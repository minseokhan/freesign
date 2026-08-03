import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GENERIC_ACTION_ERROR } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { ACCOUNT_DELETE_CONFIRM_PHRASE } from "@/lib/validation/account";

import { deleteAccount, updateProfile } from "../actions";

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

type StorageEntry = { name: string };

/**
 * Storage 목록/삭제 + RPC + signOut을 갖춘 Supabase 스텁.
 * listByPrefix는 prefix별 반환값을 지정한다 ("user-123" → 계약 폴더, "user-123/c1" → 파일).
 */
function createAccountDeleteMock(options?: {
  listByPrefix?: Record<string, StorageEntry[]>;
  listError?: { message: string };
  removeError?: { message: string };
  rpcError?: { message: string };
}) {
  // 실제 Storage처럼 limit/offset으로 잘라서 돌려준다. limit을 안 넘기면 실제 API가
  // 기본 100개에서 자르므로, 여기서도 그 호출을 오류로 취급해 회귀를 잡는다.
  const list = vi.fn(
    async (prefix: string, pageOptions?: { limit?: number; offset?: number }) => {
      if (options?.listError) {
        return { data: null, error: options.listError };
      }

      if (pageOptions?.limit === undefined) {
        return {
          data: null,
          error: { message: "limit 없이 list를 호출하면 기본 100개에서 잘린다" },
        };
      }

      const all = options?.listByPrefix?.[prefix] ?? [];
      const offset = pageOptions.offset ?? 0;

      return { data: all.slice(offset, offset + pageOptions.limit), error: null };
    },
  );
  const remove = vi.fn().mockResolvedValue({ error: options?.removeError ?? null });
  const rpc = vi.fn().mockResolvedValue({ error: options?.rpcError ?? null });
  const signOut = vi.fn().mockResolvedValue({ error: null });

  vi.mocked(createSupabaseClient).mockResolvedValue({
    storage: { from: vi.fn().mockReturnValue({ list, remove }) },
    rpc,
    auth: { signOut },
  } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

  return { list, remove, rpc, signOut };
}

describe("deleteAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
  });

  it("확인 문구가 정확하지 않으면 아무것도 지우지 않는다", async () => {
    const mock = createAccountDeleteMock();

    const result = await deleteAccount({ confirm: "계정 삭제" });

    expect(result.ok).toBe(false);
    expect(mock.remove).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("Storage 파일을 먼저 지운 뒤 계정 삭제 RPC를 호출하고 로그아웃한다", async () => {
    const mock = createAccountDeleteMock({
      listByPrefix: {
        "user-123": [{ name: "contract-1" }, { name: "contract-2" }],
        "user-123/contract-1": [{ name: "contract.pdf" }, { name: "signature.png" }],
        "user-123/contract-2": [{ name: "source.pdf" }],
      },
    });

    const result = await deleteAccount({
      confirm: ACCOUNT_DELETE_CONFIRM_PHRASE,
    });

    expect(result).toEqual({ ok: true });
    expect(mock.remove).toHaveBeenCalledWith([
      "user-123/contract-1/contract.pdf",
      "user-123/contract-1/signature.png",
      "user-123/contract-2/source.pdf",
    ]);
    expect(mock.rpc).toHaveBeenCalledWith("delete_own_account");
    expect(mock.signOut).toHaveBeenCalled();

    // 순서가 뒤집히면 세션이 죽은 뒤 파일을 못 지워 서명 이미지가 영구히 남는다.
    expect(mock.remove.mock.invocationCallOrder[0]).toBeLessThan(
      mock.rpc.mock.invocationCallOrder[0],
    );
  });

  it("Storage 삭제가 실패하면 계정 삭제 RPC를 호출하지 않는다", async () => {
    const mock = createAccountDeleteMock({
      listByPrefix: {
        "user-123": [{ name: "contract-1" }],
        "user-123/contract-1": [{ name: "contract.pdf" }],
      },
      removeError: { message: "storage down" },
    });

    const result = await deleteAccount({
      confirm: ACCOUNT_DELETE_CONFIRM_PHRASE,
    });

    expect(result.ok).toBe(false);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.signOut).not.toHaveBeenCalled();
  });

  it("활성 구독이 남아 있으면 구독 해지를 먼저 안내한다", async () => {
    const mock = createAccountDeleteMock({
      rpcError: { message: 'unexpected error: "active_subscription"' },
    });

    const result = await deleteAccount({
      confirm: ACCOUNT_DELETE_CONFIRM_PHRASE,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("구독");
    }
    expect(mock.signOut).not.toHaveBeenCalled();
  });

  it("폴더가 한 페이지(100개)를 넘어도 전부 훑어서 지운다", async () => {
    // Storage list의 기본 limit이 100이라, 페이지네이션이 없으면 101번째 계약의
    // 계약서 PDF·서명 이미지가 삭제되지 않고 남는다(개인정보 파기 누락).
    const folders = Array.from({ length: 101 }, (_, index) => ({
      name: `contract-${index}`,
    }));
    const listByPrefix: Record<string, StorageEntry[]> = {
      "user-123": folders,
    };
    for (const folder of folders) {
      listByPrefix[`user-123/${folder.name}`] = [{ name: "contract.pdf" }];
    }

    const mock = createAccountDeleteMock({ listByPrefix });

    const result = await deleteAccount({
      confirm: ACCOUNT_DELETE_CONFIRM_PHRASE,
    });

    expect(result).toEqual({ ok: true });

    const removedKeys = mock.remove.mock.calls[0][0] as string[];
    expect(removedKeys).toHaveLength(101);
    expect(removedKeys).toContain("user-123/contract-100/contract.pdf");
  });

  it("파일이 한 페이지를 넘는 폴더도 전부 훑는다", async () => {
    const files = Array.from({ length: 150 }, (_, index) => ({
      name: `file-${index}.pdf`,
    }));
    const mock = createAccountDeleteMock({
      listByPrefix: {
        "user-123": [{ name: "contract-1" }],
        "user-123/contract-1": files,
      },
    });

    await deleteAccount({ confirm: ACCOUNT_DELETE_CONFIRM_PHRASE });

    const removedKeys = mock.remove.mock.calls[0][0] as string[];
    expect(removedKeys).toHaveLength(150);
    expect(removedKeys).toContain("user-123/contract-1/file-149.pdf");
  });

  it("지울 파일이 없어도 계정 삭제는 진행된다", async () => {
    const mock = createAccountDeleteMock({ listByPrefix: { "user-123": [] } });

    const result = await deleteAccount({
      confirm: ACCOUNT_DELETE_CONFIRM_PHRASE,
    });

    expect(result).toEqual({ ok: true });
    expect(mock.remove).not.toHaveBeenCalled();
    expect(mock.rpc).toHaveBeenCalledWith("delete_own_account");
  });
});

import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { createClient, deleteClient, updateClient } from "../actions";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();

  return {
    ...actual,
    assertOwned: vi.fn(),
  };
});

const user = { id: "user-123" };

function createInsertTableMock() {
  const select = vi.fn().mockReturnThis();
  const single = vi.fn().mockResolvedValue({
    data: { id: "client-1" },
    error: null,
  });
  const insert = vi.fn().mockReturnValue({ select, single });

  return { insert, select, single };
}

function createUpdateTableMock(data: unknown = { id: "client-1" }) {
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  const single = vi.fn().mockResolvedValue({ data, error: null });
  const update = vi.fn().mockReturnValue({ eq, select, single });

  return { update, eq, select, single };
}

describe("client server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(user as Awaited<ReturnType<typeof requireUser>>);
    vi.mocked(assertOwned).mockResolvedValue(true);
  });

  it("creates a client with user_id from requireUser and strips client-owned spoofing", async () => {
    const table = createInsertTableMock();
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn().mockReturnValue(table),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const result = await createClient({
      name: "Acme Studio",
      channel: "direct",
      contact_email: "owner@acme.test",
      contact_phone: "010-1111-2222",
      memo: "Important client",
      user_id: "attacker-user",
      is_demo: true,
      deleted_at: "2026-07-07T00:00:00.000Z",
    });

    expect(result).toEqual({ ok: true, id: "client-1" });
    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(table.insert).toHaveBeenCalledWith({
      name: "Acme Studio",
      channel: "direct",
      contact_email: "owner@acme.test",
      contact_phone: "010-1111-2222",
      memo: "Important client",
      user_id: user.id,
    });
    expect(table.insert.mock.calls[0][0]).not.toMatchObject({
      is_demo: true,
      deleted_at: "2026-07-07T00:00:00.000Z",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/clients");
  });

  it.each([
    [{ name: " ", channel: "direct" }],
    [{ name: "Acme Studio", channel: "blog" }],
  ])("does not write when validation fails for %o", async (input) => {
    const table = createInsertTableMock();
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn().mockReturnValue(table),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const result = await createClient(input);

    expect(result.ok).toBe(false);
    expect(table.insert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updates only allowlisted client fields after ownership check", async () => {
    const table = createUpdateTableMock();
    const supabase = {
      from: vi.fn().mockReturnValue(table),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>;
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase);

    const result = await updateClient("client-1", {
      name: "Updated Client",
      channel: "referral",
      contact_email: "updated@example.com",
      contact_phone: "",
      memo: "",
      user_id: "attacker-user",
      is_demo: true,
      deleted_at: "2026-07-07T00:00:00.000Z",
    });

    expect(result).toEqual({ ok: true, id: "client-1" });
    expect(assertOwned).toHaveBeenCalledWith(supabase, "clients", "client-1");
    expect(table.update).toHaveBeenCalledWith({
      name: "Updated Client",
      channel: "referral",
      contact_email: "updated@example.com",
      contact_phone: null,
      memo: null,
    });
    expect(table.update.mock.calls[0][0]).not.toHaveProperty("user_id");
    expect(table.update.mock.calls[0][0]).not.toHaveProperty("is_demo");
    expect(table.update.mock.calls[0][0]).not.toHaveProperty("deleted_at");
    expect(revalidatePath).toHaveBeenCalledWith("/clients");
    expect(revalidatePath).toHaveBeenCalledWith("/clients/client-1");
  });

  it("soft-deletes a client with deleted_at update instead of hard delete", async () => {
    const table = createUpdateTableMock();
    const supabase = {
      from: vi.fn().mockReturnValue(table),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>;
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T12:00:00.000Z"));

    const result = await deleteClient("client-1");

    expect(result).toEqual({ ok: true, id: "client-1" });
    expect(assertOwned).toHaveBeenCalledWith(supabase, "clients", "client-1");
    expect(table.update).toHaveBeenCalledWith({
      deleted_at: "2026-07-07T12:00:00.000Z",
    });
    expect(table).not.toHaveProperty("delete");
    expect(revalidatePath).toHaveBeenCalledWith("/clients");
    expect(revalidatePath).toHaveBeenCalledWith("/clients/client-1");

    vi.useRealTimers();
  });
});

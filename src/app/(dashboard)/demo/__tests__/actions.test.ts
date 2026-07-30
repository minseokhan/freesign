import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { clearDemoData, seedDemoData } from "../actions";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const user = { id: "user-123", email: "freelancer@example.test" };

function createSelectIdsQuery(ids: string[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then(resolve: (value: { data: { id: string }[]; error: null }) => void) {
      return Promise.resolve({ data: ids.map((id) => ({ id })), error: null }).then(
        resolve,
      );
    },
  };
}

function createDeleteTableMock(calls: string[], label: string) {
  const query = {
    in: vi.fn((column: string, values: string[]) => {
      calls.push(label);

      return Promise.resolve({ error: null, column, values });
    }),
    eq: vi.fn(function eq() {
      return query;
    }),
    then(resolve: (value: { error: null }) => void) {
      calls.push(label);

      return Promise.resolve({ error: null }).then(resolve);
    },
  };
  const del = vi.fn(() => query);

  return { delete: del, query };
}

describe("demo data server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
  });

  // 0039: 데모 시드는 클라이언트 INSERT가 아니라 seed_demo_data DEFINER RPC로만 만든다
  // (is_demo·status·payment_status가 전부 서버 소유 필드라 INSERT 컬럼 권한이 회수됐다).
  it("seeds demo rows through the server-owned seed_demo_data RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const from = vi.fn(() => {
      throw new Error("데모 시드는 테이블에 직접 쓰지 않는다");
    });
    vi.mocked(createSupabaseClient).mockResolvedValue(
      { rpc, from } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await seedDemoData();

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("seed_demo_data");
    expect(from).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/clients");
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");
    expect(revalidatePath).toHaveBeenCalledWith("/invoices");
  });

  it("returns an error when the seed RPC fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "permission denied for table contracts" },
    });
    vi.mocked(createSupabaseClient).mockResolvedValue(
      { rpc } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await seedDemoData();

    expect(result.ok).toBe(false);
  });

  it("clears only demo rows in FK-safe child-to-parent order", async () => {
    const calls: string[] = [];
    const invoiceIdsQuery = createSelectIdsQuery(["invoice-demo"]);
    const contractIdsQuery = createSelectIdsQuery(["contract-demo"]);
    const clientIdsQuery = createSelectIdsQuery(["client-demo"]);
    const invoiceEventsDelete = createDeleteTableMock(
      calls,
      "invoice_events.delete",
    );
    const contractEventsDelete = createDeleteTableMock(
      calls,
      "contract_events.delete",
    );
    const invoicesDelete = createDeleteTableMock(calls, "invoices.delete");
    const contractsDelete = createDeleteTableMock(calls, "contracts.delete");
    const clientsDelete = createDeleteTableMock(calls, "clients.delete");
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "invoices") {
          return supabase.from.mock.calls.filter(([name]) => name === "invoices")
            .length === 1
            ? invoiceIdsQuery
            : invoicesDelete;
        }
        if (table === "contracts") {
          return supabase.from.mock.calls.filter(([name]) => name === "contracts")
            .length === 1
            ? contractIdsQuery
            : contractsDelete;
        }
        if (table === "clients") {
          return supabase.from.mock.calls.filter(([name]) => name === "clients")
            .length === 1
            ? clientIdsQuery
            : clientsDelete;
        }
        if (table === "invoice_events") return invoiceEventsDelete;
        if (table === "contract_events") return contractEventsDelete;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await clearDemoData();

    expect(result).toEqual({ ok: true });
    expect(invoiceEventsDelete.query.in).toHaveBeenCalledWith("invoice_id", [
      "invoice-demo",
    ]);
    expect(contractEventsDelete.query.in).toHaveBeenCalledWith("contract_id", [
      "contract-demo",
    ]);
    expect(invoicesDelete.query.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(invoicesDelete.query.eq).toHaveBeenCalledWith("is_demo", true);
    expect(contractsDelete.query.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(contractsDelete.query.eq).toHaveBeenCalledWith("is_demo", true);
    expect(clientsDelete.query.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(clientsDelete.query.eq).toHaveBeenCalledWith("is_demo", true);
    expect(calls).toEqual([
      "invoice_events.delete",
      "contract_events.delete",
      "invoices.delete",
      "contracts.delete",
      "clients.delete",
    ]);
  });
});

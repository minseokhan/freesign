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

function createDemoExistsQuery(exists: boolean) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: exists ? { id: "demo-client-existing" } : null,
      error: null,
    }),
  };
}

function createInsertTableMock(id: string, calls: string[], label: string) {
  const select = vi.fn().mockReturnThis();
  const single = vi.fn().mockResolvedValue({ data: { id }, error: null });
  const insert = vi.fn((payload) => {
    calls.push(label);

    return { select, single, payload };
  });

  return { insert, select, single };
}

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

  it("seeds demo rows with server-owned user_id, is_demo, and withholding snapshot", async () => {
    const calls: string[] = [];
    const demoExistsQuery = createDemoExistsQuery(false);
    const clientsInsert = createInsertTableMock("client-1", calls, "clients.insert");
    const contractsInsert = createInsertTableMock(
      "contract-1",
      calls,
      "contracts.insert",
    );
    const invoicesInsert = createInsertTableMock("invoice-1", calls, "invoices.insert");
    const contractEventsInsert = createInsertTableMock(
      "contract-event-1",
      calls,
      "contract_events.insert",
    );
    const invoiceEventsInsert = createInsertTableMock(
      "invoice-event-1",
      calls,
      "invoice_events.insert",
    );
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "clients") {
          return supabase.from.mock.calls.filter(([name]) => name === "clients")
            .length === 1
            ? demoExistsQuery
            : clientsInsert;
        }
        if (table === "contracts") return contractsInsert;
        if (table === "invoices") return invoicesInsert;
        if (table === "contract_events") return contractEventsInsert;
        if (table === "invoice_events") return invoiceEventsInsert;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await seedDemoData();

    expect(result).toEqual({ ok: true });
    expect(clientsInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: user.id,
        name: "무디",
        channel: "instagram",
        is_demo: true,
      }),
    );
    expect(contractsInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: user.id,
        client_id: "client-1",
        title: "무디 브랜드 리뉴얼",
        amount: 3_000_000,
        status: "signed",
        is_demo: true,
      }),
    );
    expect(invoicesInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: user.id,
        contract_id: "contract-1",
        client_id: "client-1",
        amount: 3_000_000,
        withholding_type: "wt_3_3",
        withholding_amount: 99_000,
        net_amount: 2_901_000,
        payment_status: "paid",
        is_demo: true,
      }),
    );
    expect(calls).toEqual([
      "clients.insert",
      "contracts.insert",
      "invoices.insert",
      "contract_events.insert",
      "invoice_events.insert",
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/clients");
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");
    expect(revalidatePath).toHaveBeenCalledWith("/invoices");
  });

  it("does not insert duplicate demo data when demo rows already exist", async () => {
    const demoExistsQuery = createDemoExistsQuery(true);
    const insertTable = createInsertTableMock("unused", [], "insert");
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn((table: string) =>
        table === "clients" ? demoExistsQuery : insertTable,
      ),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const result = await seedDemoData();

    expect(result).toEqual({ ok: true });
    expect(insertTable.insert).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
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

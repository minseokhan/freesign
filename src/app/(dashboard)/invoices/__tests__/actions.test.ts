import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { createInvoice, setInvoicePayment } from "../actions";

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

const user = { id: "user-123", email: "freelancer@example.test" };
const validInput = {
  contract_id: "11111111-1111-4111-8111-111111111111",
  amount: 1_000_000,
  issue_date: "2026-08-01",
  due_date: "2026-08-31",
  withholding_type: "wt_3_3",
};

function createMaybeSingleQuery(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function createInsertTableMock(id = "invoice-1") {
  const select = vi.fn().mockReturnThis();
  const single = vi.fn().mockResolvedValue({ data: { id }, error: null });
  const insert = vi.fn().mockReturnValue({ select, single });

  return { insert, select, single };
}

function createUpdateTableMock(id = "invoice-1") {
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  const single = vi.fn().mockResolvedValue({ data: { id }, error: null });
  const update = vi.fn().mockReturnValue({ eq, select, single });

  return { update, eq, select, single };
}

function createEventInsertTableMock() {
  const insert = vi.fn().mockResolvedValue({ error: null });

  return { insert };
}

describe("invoice server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(assertOwned).mockResolvedValue(true);
  });

  it("creates an unpaid invoice with server-owned fields and withholding snapshot", async () => {
    const contractQuery = createMaybeSingleQuery({
      id: validInput.contract_id,
      client_id: "client-from-contract",
      status: "active",
    });
    const invoiceInsertTable = createInsertTableMock();
    const eventInsertTable = createEventInsertTableMock();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "contracts") return contractQuery;
        if (table === "invoices") return invoiceInsertTable;
        if (table === "invoice_events") return eventInsertTable;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await createInvoice({
      ...validInput,
      client_id: "attacker-client",
      user_id: "attacker-user",
      payment_status: "paid",
      paid_at: "2026-08-02T00:00:00.000Z",
      payment_method: "cash",
      withholding_amount: 1,
      net_amount: 999_999,
      is_demo: true,
    });

    expect(result).toEqual({ ok: true, id: "invoice-1" });
    expect(assertOwned).toHaveBeenCalledWith(
      supabase,
      "contracts",
      validInput.contract_id,
    );
    expect(invoiceInsertTable.insert).toHaveBeenCalledWith({
      user_id: user.id,
      contract_id: validInput.contract_id,
      client_id: "client-from-contract",
      amount: validInput.amount,
      issue_date: validInput.issue_date,
      due_date: validInput.due_date,
      withholding_type: validInput.withholding_type,
      withholding_amount: 33_000,
      net_amount: 967_000,
      payment_status: "unpaid",
    });
    expect(invoiceInsertTable.insert.mock.calls[0][0]).not.toHaveProperty(
      "paid_at",
    );
    expect(invoiceInsertTable.insert.mock.calls[0][0]).not.toHaveProperty(
      "payment_method",
    );
    expect(invoiceInsertTable.insert.mock.calls[0][0]).not.toHaveProperty(
      "is_demo",
    );
    expect(eventInsertTable.insert).toHaveBeenCalledWith({
      user_id: user.id,
      invoice_id: "invoice-1",
      actor: user.id,
      from_status: null,
      to_status: "unpaid",
      event_type: "invoice.issued",
      meta: {
        contract_id: validInput.contract_id,
        client_id: "client-from-contract",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/invoices");
    expect(revalidatePath).toHaveBeenCalledWith(
      `/contracts/${validInput.contract_id}`,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/invoices/invoice-1");
    expect(supabase.from.mock.calls.map(([table]) => table)).toEqual([
      "contracts",
      "invoices",
      "invoice_events",
    ]);
  });

  it("rejects a contract_id that is not owned by the user", async () => {
    vi.mocked(assertOwned).mockResolvedValue(false);
    const supabase = { from: vi.fn() };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await createInvoice(validInput);

    expect(result).toEqual({
      ok: false,
      error: "계약을 찾을 수 없습니다.",
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a deleted or missing contract before insert", async () => {
    const contractQuery = createMaybeSingleQuery(null);
    const invoiceInsertTable = createInsertTableMock();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "contracts") return contractQuery;
        if (table === "invoices") return invoiceInsertTable;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await createInvoice(validInput);

    expect(result).toEqual({
      ok: false,
      error: "계약을 찾을 수 없습니다.",
    });
    expect(invoiceInsertTable.insert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns field errors for invalid input", async () => {
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const result = await createInvoice({
      ...validInput,
      amount: 0,
      due_date: "2026-07-31",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: "입력값을 확인해 주세요.",
      fieldErrors: {
        amount: expect.any(Array),
        due_date: expect.any(Array),
      },
    });
    expect(assertOwned).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("marks an unpaid invoice as paid with server time and appends an event after update", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T03:04:05.000Z"));

    try {
      const calls: string[] = [];
      const invoiceQuery = createMaybeSingleQuery({
        id: "invoice-1",
        payment_status: "unpaid",
      });
      const updateTable = createUpdateTableMock();
      updateTable.update.mockImplementation((payload) => {
        calls.push("invoices.update");

        expect(payload).toEqual({
          payment_status: "paid",
          paid_at: "2026-08-15T03:04:05.000Z",
          payment_method: "계좌이체",
        });

        return {
          eq: updateTable.eq,
          select: updateTable.select,
          single: updateTable.single,
        };
      });
      const eventInsertTable = createEventInsertTableMock();
      eventInsertTable.insert.mockImplementation((payload) => {
        calls.push("invoice_events.insert");

        expect(payload).toEqual({
          user_id: user.id,
          invoice_id: "invoice-1",
          actor: user.id,
          from_status: "unpaid",
          to_status: "paid",
          event_type: "invoice.payment_changed",
          meta: {
            payment_method: "계좌이체",
          },
        });

        return Promise.resolve({ error: null });
      });
      const supabase = {
        from: vi.fn((table: string) => {
          if (table === "invoice_events") return eventInsertTable;

          return supabase.from.mock.calls.filter(([name]) => name === "invoices")
            .length === 1
            ? invoiceQuery
            : updateTable;
        }),
      };
      vi.mocked(createSupabaseClient).mockResolvedValue(
        supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
      );

      const result = await setInvoicePayment("invoice-1", "paid", {
        payment_method: "계좌이체",
        paid_at: "2000-01-01T00:00:00.000Z",
        payment_status: "unpaid",
      });

      expect(result).toEqual({ ok: true, id: "invoice-1" });
      expect(calls).toEqual(["invoices.update", "invoice_events.insert"]);
      expect(updateTable.eq).toHaveBeenCalledWith("id", "invoice-1");
      expect(revalidatePath).toHaveBeenCalledWith("/invoices");
      expect(revalidatePath).toHaveBeenCalledWith("/invoices/invoice-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls a paid invoice back to unpaid and clears payment fields", async () => {
    const invoiceQuery = createMaybeSingleQuery({
      id: "invoice-1",
      payment_status: "paid",
    });
    const updateTable = createUpdateTableMock();
    const eventInsertTable = createEventInsertTableMock();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "invoice_events") return eventInsertTable;

        return supabase.from.mock.calls.filter(([name]) => name === "invoices")
          .length === 1
          ? invoiceQuery
          : updateTable;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await setInvoicePayment("invoice-1", "unpaid", {
      payment_method: "ignored",
    });

    expect(result).toEqual({ ok: true, id: "invoice-1" });
    expect(updateTable.update).toHaveBeenCalledWith({
      payment_status: "unpaid",
      paid_at: null,
      payment_method: null,
    });
    expect(eventInsertTable.insert).toHaveBeenCalledWith({
      user_id: user.id,
      invoice_id: "invoice-1",
      actor: user.id,
      from_status: "paid",
      to_status: "unpaid",
      event_type: "invoice.payment_changed",
      meta: {
        payment_method: null,
      },
    });
  });

  it("rejects draft or invalid invoice payment transitions before writing", async () => {
    const invoiceQuery = createMaybeSingleQuery({
      id: "invoice-1",
      payment_status: "draft",
    });
    const updateTable = createUpdateTableMock();
    const eventInsertTable = createEventInsertTableMock();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "invoice_events") return eventInsertTable;

        return supabase.from.mock.calls.filter(([name]) => name === "invoices")
          .length === 1
          ? invoiceQuery
          : updateTable;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    await expect(setInvoicePayment("invoice-1", "draft")).resolves.toEqual({
      ok: false,
      error: "허용되지 않는 정산 상태입니다.",
    });
    await expect(setInvoicePayment("invoice-1", "paid")).resolves.toEqual({
      ok: false,
      error: "허용되지 않는 정산 상태 전이입니다.",
    });
    expect(updateTable.update).not.toHaveBeenCalled();
    expect(eventInsertTable.insert).not.toHaveBeenCalled();
  });

  it("does not append duplicate events for no-op payment changes", async () => {
    const invoiceQuery = createMaybeSingleQuery({
      id: "invoice-1",
      payment_status: "paid",
    });
    const updateTable = createUpdateTableMock();
    const eventInsertTable = createEventInsertTableMock();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "invoice_events") return eventInsertTable;

        return supabase.from.mock.calls.filter(([name]) => name === "invoices")
          .length === 1
          ? invoiceQuery
          : updateTable;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await setInvoicePayment("invoice-1", "paid");

    expect(result).toEqual({ ok: true, id: "invoice-1" });
    expect(updateTable.update).not.toHaveBeenCalled();
    expect(eventInsertTable.insert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalledWith("/invoices/invoice-1");
  });
});

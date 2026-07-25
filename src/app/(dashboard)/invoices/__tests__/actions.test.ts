import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  createInvoice,
  deleteInvoice,
  publishDraftInvoice,
  setInvoicePayment,
} from "../actions";

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

function createRpcMock(id = "invoice-1") {
  return vi.fn().mockResolvedValue({ data: id, error: null });
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
    const rpc = createRpcMock();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "contracts") return contractQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc,
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
    expect(rpc).toHaveBeenCalledWith("issue_invoice_with_event", {
      p_contract_id: validInput.contract_id,
      p_client_id: "client-from-contract",
      p_amount: validInput.amount,
      p_issue_date: validInput.issue_date,
      p_due_date: validInput.due_date,
      p_withholding_type: validInput.withholding_type,
      p_withholding_amount: 33_000,
      p_net_amount: 967_000,
      p_actor: user.id,
      p_event_type: "invoice.issued",
      p_meta: {
        contract_id: validInput.contract_id,
        client_id: "client-from-contract",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/invoices");
    expect(revalidatePath).toHaveBeenCalledWith(
      `/contracts/${validInput.contract_id}`,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/invoices/invoice-1");
    expect(supabase.from.mock.calls.map(([table]) => table)).toEqual(["contracts"]);
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

  it("marks an unpaid invoice as paid through an atomic RPC with server time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T03:04:05.000Z"));

    try {
      const calls: string[] = [];
      const invoiceQuery = createMaybeSingleQuery({
        id: "invoice-1",
        payment_status: "unpaid",
      });
      const rpc = vi.fn().mockImplementation((fnName, args) => {
        calls.push("invoices.rpc_payment");

        expect(fnName).toBe("set_invoice_payment_with_event");
        expect(args).toEqual({
          p_invoice_id: "invoice-1",
          p_to_status: "paid",
          p_paid_at: "2026-08-15T03:04:05.000Z",
          p_payment_method: "계좌이체",
          p_actor: user.id,
          p_event_type: "invoice.payment_changed",
          p_meta: {
            payment_method: "계좌이체",
          },
        });

        return Promise.resolve({ data: "invoice-1", error: null });
      });
      const supabase = {
        from: vi.fn(() => invoiceQuery),
        rpc,
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
      expect(calls).toEqual(["invoices.rpc_payment"]);
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
    const rpc = createRpcMock();
    const supabase = {
      from: vi.fn(() => invoiceQuery),
      rpc,
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await setInvoicePayment("invoice-1", "unpaid", {
      payment_method: "ignored",
    });

    expect(result).toEqual({ ok: true, id: "invoice-1" });
    expect(rpc).toHaveBeenCalledWith("set_invoice_payment_with_event", {
      p_invoice_id: "invoice-1",
      p_to_status: "unpaid",
      p_paid_at: null,
      p_payment_method: null,
      p_actor: user.id,
      p_event_type: "invoice.payment_changed",
      p_meta: {
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

  it("soft-deletes an invoice with deleted_at update after ownership check", async () => {
    const updateTable = createUpdateTableMock();
    const supabase = {
      from: vi.fn().mockReturnValue(updateTable),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>;
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T09:00:00.000Z"));

    const result = await deleteInvoice("invoice-1");

    expect(result).toEqual({ ok: true, id: "invoice-1" });
    expect(assertOwned).toHaveBeenCalledWith(supabase, "invoices", "invoice-1");
    expect(updateTable.update).toHaveBeenCalledWith({
      deleted_at: "2026-07-14T09:00:00.000Z",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/invoices");
    expect(revalidatePath).toHaveBeenCalledWith("/invoices/invoice-1");

    vi.useRealTimers();
  });

  it("rejects invoice deletion when ownership check fails", async () => {
    const updateTable = createUpdateTableMock();
    const supabase = {
      from: vi.fn().mockReturnValue(updateTable),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>;
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase);
    vi.mocked(assertOwned).mockResolvedValueOnce(false);

    const result = await deleteInvoice("invoice-1");

    expect(result).toEqual({ ok: false, error: "인보이스를 찾을 수 없습니다." });
    expect(updateTable.update).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("publishDraftInvoice: draft를 unpaid로 발행하고 invoice.issued 이벤트를 남긴다", async () => {
    const invoiceQuery = createMaybeSingleQuery({
      id: "invoice-1",
      payment_status: "draft",
    });
    const rpc = createRpcMock();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "invoices") return invoiceQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc,
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await publishDraftInvoice("invoice-1");

    expect(result).toEqual({ ok: true, id: "invoice-1" });
    expect(rpc).toHaveBeenCalledWith(
      "set_invoice_payment_with_event",
      expect.objectContaining({
        p_invoice_id: "invoice-1",
        p_to_status: "unpaid",
        p_event_type: "invoice.issued",
      }),
    );
  });

  it("publishDraftInvoice: 이미 발행(unpaid)된 인보이스는 발행하지 않는다", async () => {
    const invoiceQuery = createMaybeSingleQuery({
      id: "invoice-1",
      payment_status: "unpaid",
    });
    const rpc = createRpcMock();
    const supabase = {
      from: vi.fn(() => invoiceQuery),
      rpc,
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await publishDraftInvoice("invoice-1");

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

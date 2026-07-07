import { renderToBuffer } from "@react-pdf/renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { GET, maxDuration, runtime } from "../route";

vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: vi.fn(),
}));

vi.mock("@/components/pdf/invoice-document", () => ({
  InvoiceDocument: vi.fn(() => null),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();

  return {
    ...actual,
    assertOwned: vi.fn(),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const user = { id: "user-123", email: "freelancer@example.test" };

const invoice = {
  id: "invoice-1",
  amount: 3000000,
  issue_date: "2026-07-01",
  due_date: "2026-07-31",
  withholding_type: "wt_3_3",
  withholding_amount: 99000,
  net_amount: 2901000,
  payment_status: "unpaid",
  paid_at: null,
  client: {
    name: "테스트 클라이언트",
  },
  contract: {
    title: "브랜드 웹사이트 제작",
  },
};

const profile = {
  bank_name: "국민은행",
  bank_account_number: "123-456-789",
  bank_account_holder: "홍길동",
};

function createQuery(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

describe("GET /api/invoices/[id]/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(assertOwned).mockResolvedValue(true);
    vi.mocked(renderToBuffer).mockResolvedValue(Buffer.from("%PDF-1.7"));
  });

  it("runs in node with a longer PDF render duration", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBeGreaterThanOrEqual(30);
  });

  it("renders invoice PDF bytes from owned invoice snapshots without storing a public URL", async () => {
    const invoiceQuery = createQuery(invoice);
    const profileQuery = createQuery(profile);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "invoices") return invoiceQuery;
        if (table === "profiles") return profileQuery;

        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "invoice-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="invoice-invoice-1.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.arrayBuffer()).resolves.toEqual(
      Buffer.from("%PDF-1.7").buffer.slice(
        Buffer.from("%PDF-1.7").byteOffset,
        Buffer.from("%PDF-1.7").byteOffset + Buffer.from("%PDF-1.7").byteLength,
      ),
    );
    expect(requireUser).toHaveBeenCalled();
    expect(assertOwned).toHaveBeenCalledWith(supabase, "invoices", "invoice-1");
    expect(invoiceQuery.select).toHaveBeenCalledWith(
      "id,amount,issue_date,due_date,withholding_type,withholding_amount,net_amount,payment_status,paid_at,client:clients(name),contract:contracts(title)",
    );
    expect(profileQuery.select).toHaveBeenCalledWith(
      "bank_name,bank_account_number,bank_account_holder",
    );
    expect(renderToBuffer).toHaveBeenCalled();
  });

  it("does not render when the invoice is not owned", async () => {
    vi.mocked(assertOwned).mockResolvedValue(false);
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "invoice-1" }),
    });

    expect(response.status).toBe(404);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });
});

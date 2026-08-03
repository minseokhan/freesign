// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAnonClient } from "@/lib/supabase/anon";
import type { Json } from "@/types/database";

import { GET } from "../pdf/route";

vi.mock("@/lib/supabase/anon", () => ({
  createAnonClient: vi.fn(),
}));

vi.mock("@/lib/invoices/render-pdf", () => ({
  renderInvoicePdf: vi.fn(async () => Buffer.from("invoice-pdf")),
}));

vi.mock("@/lib/posthog-server", () => ({
  captureServerException: vi.fn(),
}));

const RAW_TOKEN = "raw-invoice-token-for-tests";

const activeView: Json = {
  state: "active",
  invoice_id: "invoice-1",
  payment_status: "unpaid",
  amount: 1_000_000,
  withholding_type: "wt_3_3",
  withholding_amount: 33_000,
  net_amount: 967_000,
  issue_date: "2026-08-01",
  due_date: "2026-08-31",
  paid_at: null,
  contract_title: "웹사이트 제작",
  client_name: "Acme",
  sender_name: "한프리",
  bank_name: "국민은행",
  bank_account_number: "123456-78-901234",
  bank_account_holder: "김프리",
  expires_at: "2026-11-29T00:00:00.000Z",
};

function mockAnonClient(options: {
  rateLimited?: boolean;
  view?: Json | null;
}) {
  const rpc = vi.fn((name: string) => {
    if (name === "consume_anon_rate_limit") {
      return Promise.resolve({ data: !options.rateLimited, error: null });
    }

    if (name === "get_invoice_view") {
      return Promise.resolve({ data: options.view ?? null, error: null });
    }

    throw new Error(`Unexpected rpc: ${name}`);
  });

  vi.mocked(createAnonClient).mockReturnValue({
    rpc,
  } as unknown as ReturnType<typeof createAnonClient>);

  return { rpc };
}

function request() {
  return new Request("https://freesign.example/api/invoice/token/pdf");
}

function context(token = RAW_TOKEN) {
  return { params: Promise.resolve({ token }) };
}

describe("GET /api/invoice/[token]/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("활성 토큰이면 PDF를 반환한다", async () => {
    mockAnonClient({ view: activeView });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    // 소유자 사본과 같은 문서번호를 쓴다(대조 가능해야 한다).
    expect(response.headers.get("content-disposition")).toContain("invoice-1");
  });

  it("원문 토큰이 아니라 해시로 조회한다", async () => {
    const { rpc } = mockAnonClient({ view: activeView });

    await GET(request(), context());

    const call = rpc.mock.calls.find((c) => c[0] === "get_invoice_view");
    const tokenHash = (call?.[1] as { p_token_hash: string }).p_token_hash;

    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toBe(RAW_TOKEN);
  });

  it("없는 토큰은 404", async () => {
    mockAnonClient({ view: null });

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
  });

  it("만료·회수된 토큰은 404 (PDF를 렌더하지 않는다)", async () => {
    mockAnonClient({ view: { state: "expired" } });
    expect((await GET(request(), context())).status).toBe(404);

    mockAnonClient({ view: { state: "revoked" } });
    expect((await GET(request(), context())).status).toBe(404);
  });

  it("빈 토큰은 조회 없이 404", async () => {
    const { rpc } = mockAnonClient({ view: activeView });

    const response = await GET(request(), context("  "));

    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("레이트리밋에 걸리면 429이고 조회하지 않는다", async () => {
    const { rpc } = mockAnonClient({ rateLimited: true, view: activeView });

    const response = await GET(request(), context());

    expect(response.status).toBe(429);
    expect(rpc).not.toHaveBeenCalledWith("get_invoice_view", expect.anything());
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderContractPdf } from "@/lib/contracts/render-pdf";
import { createAnonClient } from "@/lib/supabase/anon";
import type { Json } from "@/types/database";

import { GET } from "../route";

vi.mock("@/lib/supabase/anon", () => ({
  createAnonClient: vi.fn(),
}));

vi.mock("@/lib/contracts/render-pdf", () => ({
  renderContractPdf: vi.fn(async () => Buffer.from("contract-pdf")),
}));

vi.mock("@/lib/posthog-server", () => ({
  captureServerException: vi.fn(),
}));

const SIGNATURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

const signedContractData: Json = {
  owner_user_id: "owner-user-1",
  client_name: "발주사",
  contract: {
    id: "contract-1",
    title: "웹사이트 구축",
    scope: "랜딩 페이지 제작",
    amount: 2500000,
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    status: "signed",
    clauses: [{ title: "제1조", body: "본문", plain_summary: "요약" }],
    plain_summary: null,
    doc_hash: "a".repeat(64),
    signature_meta: {
      signer: "owner@example.test",
      signed_at: "2026-07-16T09:00:00.000Z",
      ip: "198.51.100.1",
      ua: "OwnerAgent",
    },
  },
  counterparty_signature: {
    signer_name: "김담당",
    signer_email: "counterparty@example.test",
    signed_at: "2026-07-17T01:00:00.000Z",
    signature_image_data: SIGNATURE_DATA_URL,
  },
};

function mockAnonClient(handlers: {
  rateLimit?: { data: boolean | null; error: { message: string } | null };
  signed?: { data: Json | null; error: { message: string } | null };
}) {
  const rpc = vi.fn((fnName: string) => {
    if (fnName === "consume_anon_rate_limit") {
      return Promise.resolve(handlers.rateLimit ?? { data: true, error: null });
    }

    if (fnName === "get_signed_contract_data") {
      return Promise.resolve(
        handlers.signed ?? { data: signedContractData, error: null },
      );
    }

    return Promise.resolve({
      data: null,
      error: { message: `unexpected rpc ${fnName}` },
    });
  });

  vi.mocked(createAnonClient).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof createAnonClient
  >);

  return rpc;
}

function createRequest() {
  return new Request("http://localhost/api/sign/raw-token/pdf", {
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
}

function routeContext(token = "raw-signing-token-for-tests") {
  return { params: Promise.resolve({ token }) };
}

describe("GET /api/sign/[token]/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 for tokens without completed contract data", async () => {
    mockAnonClient({ signed: { data: null, error: null } });

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(404);
  });

  it("returns 429 when the anon rate limit is exhausted", async () => {
    const rpc = mockAnonClient({ rateLimit: { data: false, error: null } });

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(429);
    expect(rpc).not.toHaveBeenCalledWith(
      "get_signed_contract_data",
      expect.anything(),
    );
  });

  it("renders the signed contract pdf with the counterparty signature slot", async () => {
    mockAnonClient({});

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(vi.mocked(renderContractPdf)).toHaveBeenCalledWith(
      expect.objectContaining({
        counterpartySignature: expect.objectContaining({
          imageDataUri: SIGNATURE_DATA_URL,
          name: "김담당",
        }),
      }),
    );
  });
});

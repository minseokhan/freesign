// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAnonClient } from "@/lib/supabase/anon";
import type { Json } from "@/types/database";

import { GET } from "../route";

vi.mock("@/lib/supabase/anon", () => ({
  createAnonClient: vi.fn(),
}));

vi.mock("@/lib/contracts/render-pdf", () => ({
  renderCertificatePdf: vi.fn(async () => Buffer.from("certificate-pdf")),
}));

vi.mock("@/lib/posthog-server", () => ({
  captureServerException: vi.fn(),
}));

const certificateData: Json = {
  contract: {
    id: "contract-1",
    title: "웹사이트 구축",
    clauses: [],
    doc_hash: "a".repeat(64),
  },
  signatures: [
    {
      party: "owner",
      signer_name: "한프리",
      signer_email: "owner@example.test",
      signed_at: "2026-07-16T09:00:00.000Z",
      consent: {},
      meta: {},
    },
    {
      party: "counterparty",
      signer_name: "김담당",
      signer_email: "counterparty@example.test",
      signed_at: "2026-07-17T01:00:00.000Z",
      consent: {},
      meta: {},
    },
  ],
  events: [],
  tsa: { sent_tsa_token: null, completion_tsa_token: null },
  completed_at: "2026-07-17T01:00:00.000Z",
};

function mockAnonClient(handlers: {
  rateLimit?: { data: boolean | null; error: { message: string } | null };
  certificate?: { data: Json | null; error: { message: string } | null };
}) {
  const rpc = vi.fn((fnName: string) => {
    if (fnName === "consume_anon_rate_limit") {
      return Promise.resolve(handlers.rateLimit ?? { data: true, error: null });
    }

    if (fnName === "get_certificate_data") {
      return Promise.resolve(
        handlers.certificate ?? { data: certificateData, error: null },
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
  return new Request("http://localhost/api/sign/raw-token/certificate", {
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
}

function routeContext(token = "raw-signing-token-for-tests") {
  return { params: Promise.resolve({ token }) };
}

describe("GET /api/sign/[token]/certificate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 for tokens without completed certificate data", async () => {
    mockAnonClient({ certificate: { data: null, error: null } });

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(404);
  });

  it("returns 429 when the anon rate limit is exhausted", async () => {
    const rpc = mockAnonClient({ rateLimit: { data: false, error: null } });

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(429);
    expect(rpc).toHaveBeenCalledWith(
      "consume_anon_rate_limit",
      expect.objectContaining({ p_bucket: "certificate_download" }),
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "get_certificate_data",
      expect.anything(),
    );
  });

  it("renders the certificate pdf for completed tokens", async () => {
    mockAnonClient({});

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

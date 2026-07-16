// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderCertificatePdf } from "@/lib/contracts/render-pdf";
import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { GET, maxDuration, runtime } from "../route";

vi.mock("@/lib/contracts/render-pdf", () => ({
  renderCertificatePdf: vi.fn(),
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

const contract = {
  id: "contract-1",
  title: "웹사이트 제작 계약서",
  doc_hash: "a".repeat(64),
  signature_meta: {
    signer: "freelancer@example.test",
    signed_at: "2026-07-15T01:00:00.000Z",
    ip: "198.51.100.1",
    ua: "OwnerAgent",
  },
};

const ownerSignature = {
  party: "owner",
  signer_name: "김하나",
  signer_email: "freelancer@example.test",
  signed_at: "2026-07-15T01:00:00.000Z",
  consent: { electronic_signature: true, privacy: true },
  meta: {},
};

const counterpartySignature = {
  party: "counterparty",
  signer_name: "박담당",
  signer_email: "counterparty@example.test",
  signed_at: "2026-07-16T02:00:00.000Z",
  consent: { electronic_signature: true, privacy: true },
  meta: { ip: "203.0.113.10", ua: "CounterpartyAgent" },
};

function createSupabaseMock({
  signatures = [ownerSignature, counterpartySignature],
}: {
  signatures?: unknown[];
} = {}) {
  const contractQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: contract, error: null }),
  };
  const signaturesQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: signatures, error: null }),
  };
  const requestQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        recipient_email: "counterparty@example.test",
        frozen_doc_hash: "a".repeat(64),
        sent_tsa_token: null,
        completion_tsa_token: null,
        completed_at: "2026-07-16T02:00:00.000Z",
      },
      error: null,
    }),
  };
  const eventsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === "contracts") return contractQuery;
      if (table === "contract_signatures") return signaturesQuery;
      if (table === "signature_requests") return requestQuery;
      if (table === "contract_events") return eventsQuery;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe("GET /api/contracts/[id]/certificate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(assertOwned).mockResolvedValue(true);
    vi.mocked(renderCertificatePdf).mockResolvedValue(Buffer.from("%PDF-1.7"));
  });

  it("runs in node with a longer PDF render duration", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBeGreaterThanOrEqual(30);
  });

  it("renders the certificate PDF for a completed mutual signature", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "contract-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="certificate-contract-1.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(assertOwned).toHaveBeenCalledWith(supabase, "contracts", "contract-1");
    expect(renderCertificatePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: "contract-1",
        docHash: "a".repeat(64),
      }),
    );
  });

  it("rejects certificates for contracts without a counterparty signature", async () => {
    const supabase = createSupabaseMock({ signatures: [ownerSignature] });
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "contract-1" }),
    });

    expect(response.status).toBe(409);
    expect(renderCertificatePdf).not.toHaveBeenCalled();
  });

  it("does not render when the contract is not owned", async () => {
    vi.mocked(assertOwned).mockResolvedValue(false);
    vi.mocked(createSupabaseClient).mockResolvedValue(
      createSupabaseMock() as unknown as Awaited<
        ReturnType<typeof createSupabaseClient>
      >,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "contract-1" }),
    });

    expect(response.status).toBe(404);
    expect(renderCertificatePdf).not.toHaveBeenCalled();
  });
});

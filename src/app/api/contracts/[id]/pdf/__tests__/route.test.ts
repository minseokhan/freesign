import { revalidatePath } from "next/cache";
import { renderToBuffer } from "@react-pdf/renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { GET, maxDuration, runtime } from "../route";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: vi.fn(),
}));

vi.mock("@/components/pdf/contract-document", () => ({
  ContractDocument: vi.fn(() => null),
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
  scope: "기업 웹사이트 제작",
  amount: 1500000,
  start_date: "2026-07-01",
  end_date: "2026-07-31",
  status: "signed",
  clauses: [
    {
      title: "용역 범위",
      body: "랜딩 페이지 디자인 및 구현",
      plain_summary: "랜딩 페이지를 제작합니다.",
      needs_review: false,
    },
  ],
  doc_hash: "doc-hash",
  signature_image_path: "user-123/contract-1/signature.png",
  signature_meta: {
    signer: "freelancer@example.test",
    signed_at: "2026-07-07T03:00:00.000Z",
    ip: "203.0.113.10",
    ua: "Vitest",
  },
  client: {
    name: "테스트 클라이언트",
  },
};

function createReadQuery() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: contract, error: null }),
  };
}

function createUpdateQuery() {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });

  return { update, eq };
}

function createStorage() {
  const download = vi.fn().mockResolvedValue({
    data: {
      type: "image/png",
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    },
    error: null,
  });
  const upload = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn().mockReturnValue({ download, upload });

  return { from, download, upload };
}

describe("GET /api/contracts/[id]/pdf", () => {
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

  it("renders, uploads, stores only the private PDF key, and returns PDF bytes", async () => {
    const readQuery = createReadQuery();
    const updateQuery = createUpdateQuery();
    const storage = createStorage();
    const supabase = {
      storage,
      from: vi.fn((table: string) => {
        if (table !== "contracts") {
          throw new Error(`Unexpected table: ${table}`);
        }

        return supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? readQuery
          : updateQuery;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "contract-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    await expect(response.arrayBuffer()).resolves.toEqual(
      Buffer.from("%PDF-1.7").buffer.slice(
        Buffer.from("%PDF-1.7").byteOffset,
        Buffer.from("%PDF-1.7").byteOffset + Buffer.from("%PDF-1.7").byteLength,
      ),
    );
    expect(assertOwned).toHaveBeenCalledWith(supabase, "contracts", "contract-1");
    expect(storage.from).toHaveBeenCalledWith("contract-artifacts");
    expect(storage.download).toHaveBeenCalledWith(
      "user-123/contract-1/signature.png",
    );
    expect(renderToBuffer).toHaveBeenCalled();
    expect(storage.upload).toHaveBeenCalledWith(
      "user-123/contract-1/contract.pdf",
      Buffer.from("%PDF-1.7"),
      expect.objectContaining({
        contentType: "application/pdf",
        upsert: true,
      }),
    );
    expect(updateQuery.update).toHaveBeenCalledWith({
      contract_pdf_url: "user-123/contract-1/contract.pdf",
    });
    expect(updateQuery.eq).toHaveBeenCalledWith("id", "contract-1");
    expect(response.headers.get("x-freesign-pdf-storage-key")).toBe(
      "user-123/contract-1/contract.pdf",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");
    expect(revalidatePath).toHaveBeenCalledWith("/contracts/contract-1");
  });

  it("does not render when the contract is not owned", async () => {
    vi.mocked(assertOwned).mockResolvedValue(false);
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn(),
      storage: createStorage(),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "contract-1" }),
    });

    expect(response.status).toBe(404);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });
});

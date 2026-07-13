import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { GET, runtime } from "../route";

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

function createReadQuery(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function createSignedUrlStorage(signedUrl: string | null) {
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: signedUrl ? { signedUrl } : null,
    error: signedUrl ? null : { message: "no url" },
  });
  const from = vi.fn().mockReturnValue({ createSignedUrl });

  return { from, createSignedUrl };
}

describe("GET /api/contracts/[id]/source-pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(assertOwned).mockResolvedValue(true);
  });

  it("runs in the node runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("redirects the owner to a short-lived signed URL for the source PDF", async () => {
    const readQuery = createReadQuery({
      id: "contract-1",
      source_pdf_url: "user-123/contract-1/source.pdf",
    });
    const storage = createSignedUrlStorage(
      "https://storage.example/signed/source.pdf",
    );
    const supabase = {
      from: vi.fn().mockReturnValue(readQuery),
      storage,
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "contract-1" }),
    });

    expect(assertOwned).toHaveBeenCalledWith(supabase, "contracts", "contract-1");
    expect(storage.from).toHaveBeenCalledWith("contract-artifacts");
    // 원본 PDF도 브라우저에서 바로 열리도록 download 옵션 없이 inline으로 서명 URL을 만든다.
    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      "user-123/contract-1/source.pdf",
      300,
    );
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toBe(
      "https://storage.example/signed/source.pdf",
    );
  });

  it("returns 404 when the contract is not owned by the user", async () => {
    vi.mocked(assertOwned).mockResolvedValue(false);
    const storage = createSignedUrlStorage("https://storage.example/x");
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn(),
      storage,
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "contract-1" }),
    });

    expect(response.status).toBe(404);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns 404 when the contract has no source PDF", async () => {
    const readQuery = createReadQuery({
      id: "contract-1",
      source_pdf_url: null,
    });
    const storage = createSignedUrlStorage("https://storage.example/x");
    const supabase = {
      from: vi.fn().mockReturnValue(readQuery),
      storage,
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "contract-1" }),
    });

    expect(response.status).toBe(404);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});

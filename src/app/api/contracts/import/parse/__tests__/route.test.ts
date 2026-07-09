import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { extractContractFromPdf } from "@/services/ai/contract-import";

import { maxDuration, POST, runtime } from "../route";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/services/ai/contract-import", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/ai/contract-import")>();

  return {
    ...actual,
    extractContractFromPdf: vi.fn(),
  };
});

const user = { id: "user-123", email: "freelancer@example.test" };
const extracted = {
  title: "발주처 계약서",
  scope: "브랜드 리뉴얼",
  amount: 3_000_000,
  start_date: "2026-08-01",
  end_date: "2026-08-31",
  clauses: [],
  source: "ai" as const,
};

function createRequest(file: File | string | null) {
  const formData = new FormData();

  if (file !== null) {
    formData.set("file", file);
  }

  return {
    formData: vi.fn().mockResolvedValue(formData),
  } as unknown as Request;
}

describe("POST /api/contracts/import/parse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(extractContractFromPdf).mockResolvedValue(extracted);
  });

  it("runs on node with a longer PDF parse duration", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });

  it("authorizes, parses a PDF preview, and returns the extracted data without writes", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "contract.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    });

    const response = await POST(createRequest(file));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ extracted });
    expect(requireUser).toHaveBeenCalled();
    expect(extractContractFromPdf).toHaveBeenCalledWith("AQID");
  });

  it("rejects missing or non-file uploads before parsing", async () => {
    const missingResponse = await POST(createRequest(null));
    const stringResponse = await POST(createRequest("not-a-file"));

    expect(missingResponse.status).toBe(400);
    expect(stringResponse.status).toBe(400);
    expect(extractContractFromPdf).not.toHaveBeenCalled();
  });

  it("rejects non-PDF uploads", async () => {
    const file = new File(["hello"], "contract.txt", { type: "text/plain" });

    const response = await POST(createRequest(file));

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: "PDF 파일만 업로드할 수 있습니다.",
    });
    expect(extractContractFromPdf).not.toHaveBeenCalled();
  });

  it("rejects PDF uploads larger than 5MB", async () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.pdf", {
      type: "application/pdf",
    });

    const response = await POST(createRequest(file));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "5MB 이하 PDF만 업로드할 수 있습니다.",
    });
    expect(extractContractFromPdf).not.toHaveBeenCalled();
  });
});

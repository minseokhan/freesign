import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { generateContractDraft } from "@/services/ai/contract-draft";

import { POST } from "../route";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/services/ai/contract-draft", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/ai/contract-draft")>();

  return {
    ...actual,
    generateContractDraft: vi.fn(),
  };
});

const user = { id: "user-123", email: "freelancer@example.test" };

function createMaybeSingleQuery(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

describe("POST /api/contracts/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(generateContractDraft).mockResolvedValue({
      title: "블루스튜디오 용역계약서 초안",
      body: "1. 당사자\n서버에서 생성된 초안입니다.",
      plain_summary: "서버에서 생성한 요약입니다.",
      needs_review: true,
      source: "skeleton",
    });
  });

  it("maps client and freelancer names from server-side reads before generating a draft", async () => {
    const clientsQuery = createMaybeSingleQuery({ name: "블루스튜디오" });
    const profilesQuery = createMaybeSingleQuery({ display_name: "김프리" });
    const supabase = {
      from: vi.fn((table: string) =>
        table === "clients" ? clientsQuery : profilesQuery,
      ),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const response = await POST(
      new Request("http://localhost/api/contracts/draft", {
        method: "POST",
        body: JSON.stringify({
          title: "블루스튜디오 브랜드 랜딩 계약",
          client_id: "11111111-1111-4111-8111-111111111111",
          scope: "브랜드 랜딩 페이지 디자인",
          amount: 3_000_000,
          start_date: "2026-08-01",
          end_date: "2026-08-31",
          due_date: "2026-09-10",
          clientName: "위조 클라이언트",
          freelancerName: "위조 프리랜서",
        }),
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      draft: {
        source: "skeleton",
        clauses: expect.any(Array),
      },
    });
    expect(response.status).toBe(200);
    expect(generateContractDraft).toHaveBeenCalledWith({
      freelancerName: "김프리",
      clientName: "블루스튜디오",
      scope: "브랜드 랜딩 페이지 디자인",
      amount: 3_000_000,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      dueDate: "2026-09-10",
    });
  });

  it("returns 404 when the client is not owned by the user", async () => {
    const clientsQuery = createMaybeSingleQuery(null);
    const profilesQuery = createMaybeSingleQuery({ display_name: "김프리" });
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn((table: string) =>
        table === "clients" ? clientsQuery : profilesQuery,
      ),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const response = await POST(
      new Request("http://localhost/api/contracts/draft", {
        method: "POST",
        body: JSON.stringify({
          title: "블루스튜디오 브랜드 랜딩 계약",
          client_id: "11111111-1111-4111-8111-111111111111",
          scope: "브랜드 랜딩 페이지 디자인",
          amount: 3_000_000,
          start_date: "2026-08-01",
          end_date: "2026-08-31",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(generateContractDraft).not.toHaveBeenCalled();
  });
});

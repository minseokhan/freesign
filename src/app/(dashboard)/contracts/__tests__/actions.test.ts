import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { generateContractDraft } from "@/services/ai/contract-draft";

import { createContractDraft } from "../actions";

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

vi.mock("@/services/ai/contract-draft", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/ai/contract-draft")>();

  return {
    ...actual,
    generateContractDraft: vi.fn(),
  };
});

const user = { id: "user-123", email: "freelancer@example.test" };
const validInput = {
  client_id: "11111111-1111-4111-8111-111111111111",
  scope: "브랜드 랜딩 페이지 디자인과 반응형 퍼블리싱",
  amount: 3_000_000,
  start_date: "2026-08-01",
  end_date: "2026-08-31",
  due_date: "2026-09-10",
};

function createMaybeSingleQuery(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function createInsertTableMock(id = "contract-1") {
  const select = vi.fn().mockReturnThis();
  const single = vi.fn().mockResolvedValue({ data: { id }, error: null });
  const insert = vi.fn().mockReturnValue({ select, single });

  return { insert, select, single };
}

function createUpdateTableMock(id = "contract-1") {
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  const single = vi.fn().mockResolvedValue({ data: { id }, error: null });
  const update = vi.fn().mockReturnValue({ eq, select, single });

  return { update, eq, select, single };
}

describe("contract draft server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(assertOwned).mockResolvedValue(true);
    vi.mocked(generateContractDraft).mockResolvedValue({
      title: "블루스튜디오 용역계약서 초안",
      body: "1. 당사자\n서버 생성 초안입니다.\n\n2. 용역 범위\n작업 범위입니다.",
      plain_summary: "서버 생성 요약입니다.",
      needs_review: true,
      source: "skeleton",
    });
  });

  it("creates a draft contract with server-owned user_id and fixed draft status", async () => {
    const clientsQuery = createMaybeSingleQuery({ name: "블루스튜디오" });
    const profilesQuery = createMaybeSingleQuery({ display_name: "김프리" });
    const existingDraftQuery = createMaybeSingleQuery(null);
    const insertTable = createInsertTableMock();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "clients") return clientsQuery;
        if (table === "profiles") return profilesQuery;
        return supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? existingDraftQuery
          : insertTable;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await createContractDraft({
      ...validInput,
      user_id: "attacker-user",
      status: "signed",
      clauses: [{ title: "위조 조항" }],
      doc_hash: "spoofed",
      is_demo: true,
    });

    expect(result).toEqual({ ok: true, id: "contract-1" });
    expect(assertOwned).toHaveBeenCalledWith(
      supabase,
      "clients",
      validInput.client_id,
    );
    expect(generateContractDraft).toHaveBeenCalledWith({
      freelancerName: "김프리",
      clientName: "블루스튜디오",
      scope: validInput.scope,
      amount: validInput.amount,
      startDate: validInput.start_date,
      endDate: validInput.end_date,
      dueDate: validInput.due_date,
    });
    expect(insertTable.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: user.id,
        client_id: validInput.client_id,
        scope: validInput.scope,
        amount: validInput.amount,
        start_date: validInput.start_date,
        end_date: validInput.end_date,
        status: "draft",
      }),
    );
    expect(insertTable.insert.mock.calls[0][0]).not.toHaveProperty("doc_hash");
    expect(insertTable.insert.mock.calls[0][0]).not.toHaveProperty("is_demo");
    expect(insertTable.insert.mock.calls[0][0].clauses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "당사자",
          source: "skeleton",
          needs_review: true,
        }),
      ]),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");
  });

  it("updates an existing matching draft instead of inserting a duplicate", async () => {
    const clientsQuery = createMaybeSingleQuery({ name: "블루스튜디오" });
    const profilesQuery = createMaybeSingleQuery({ display_name: "김프리" });
    const existingDraftQuery = createMaybeSingleQuery({ id: "contract-1" });
    const updateTable = createUpdateTableMock();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "clients") return clientsQuery;
        if (table === "profiles") return profilesQuery;
        return supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? existingDraftQuery
          : updateTable;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await createContractDraft(validInput);

    expect(result).toEqual({ ok: true, id: "contract-1" });
    expect(updateTable.update).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "블루스튜디오 용역계약서 초안",
        clauses: expect.any(Array),
        status: "draft",
      }),
    );
    expect(updateTable.eq).toHaveBeenCalledWith("id", "contract-1");
    expect(updateTable).not.toHaveProperty("insert");
  });

  it("rejects a client_id that is not owned by the user", async () => {
    vi.mocked(assertOwned).mockResolvedValue(false);
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const result = await createContractDraft(validInput);

    expect(result).toEqual({
      ok: false,
      error: "클라이언트를 찾을 수 없습니다.",
    });
    expect(generateContractDraft).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("still saves a contract when AI generation falls back to skeleton output", async () => {
    vi.mocked(generateContractDraft).mockResolvedValue({
      title: "골격 초안",
      body: "1. 당사자\n골격 조항입니다.",
      plain_summary: "AI 실패 시 골격으로 저장됩니다.",
      needs_review: true,
      source: "skeleton",
    });
    const clientsQuery = createMaybeSingleQuery({ name: "블루스튜디오" });
    const profilesQuery = createMaybeSingleQuery({ display_name: "김프리" });
    const existingDraftQuery = createMaybeSingleQuery(null);
    const insertTable = createInsertTableMock("contract-skeleton");
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "clients") return clientsQuery;
        if (table === "profiles") return profilesQuery;
        return supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? existingDraftQuery
          : insertTable;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await createContractDraft(validInput);

    expect(result).toEqual({ ok: true, id: "contract-skeleton" });
    expect(insertTable.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "골격 초안",
        status: "draft",
      }),
    );
  });
});

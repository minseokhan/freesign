import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { generateContractDraft } from "@/services/ai/contract-draft";
import { createV1SignatureProvider } from "@/services/signature/provider";

import {
  createContractDraft,
  createImportedContract,
  transitionContractStatus,
  updateContractClauses,
} from "../actions";

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
  title: "블루스튜디오 브랜드 랜딩 계약",
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

function createContractStatusReadQuery(status: string) {
  return createMaybeSingleQuery({ id: "contract-1", status });
}

function createEventInsertTableMock() {
  const insert = vi.fn().mockResolvedValue({ error: null });

  return { insert };
}

function createImportedContractFormData(
  payload: Record<string, unknown>,
  file?: File,
) {
  const formData = new FormData();

  formData.set("payload", JSON.stringify(payload));

  if (file) {
    formData.set("file", file);
  }

  return formData;
}

const SOURCE_PDF_BYTES = new TextEncoder().encode("%PDF-1.7");

function createSourcePdfFile() {
  const file = new File([SOURCE_PDF_BYTES], "source.pdf", {
    type: "application/pdf",
  });
  // 실제 File.arrayBuffer 대신 정확히 크기가 맞는 ArrayBuffer를 반환해 해시를 결정적으로 만든다.
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn().mockResolvedValue(SOURCE_PDF_BYTES.buffer),
  });

  return file;
}

const validClauses = [
  "당사자",
  "용역 범위",
  "계약 기간",
  "대금 및 지급",
  "검수 및 수정",
  "자료 제공 및 협조",
  "비밀유지",
  "지식재산권",
  "해지",
  "분쟁 해결",
].map((title) => ({
  title,
  body: `${title} 조항 본문입니다.`,
  plain_summary: `${title} 조항 요약입니다.`,
  needs_review: false,
}));

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
        // 계약 전체 요약은 계약 레벨 컬럼에 1회만 저장한다.
        plain_summary: "서버 생성 요약입니다.",
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
          // 조항별 요약은 더 이상 계약 전체 요약을 복제하지 않는다.
          plain_summary: "",
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
        title: validInput.title,
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
        title: validInput.title,
        status: "draft",
      }),
    );
  });

  it("updates clauses only for an owned draft contract", async () => {
    const contractQuery = createMaybeSingleQuery({ id: "contract-1", status: "draft" });
    const updateTable = createUpdateTableMock();
    const supabase = {
      from: vi.fn((table: string) =>
        table === "contracts" &&
        supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? contractQuery
          : updateTable,
      ),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await updateContractClauses("contract-1", {
      clauses: validClauses,
      user_id: "attacker-user",
      status: "signed",
      doc_hash: "spoofed",
    });

    expect(result).toEqual({ ok: true, id: "contract-1" });
    expect(contractQuery.select).toHaveBeenCalledWith("id,status");
    expect(contractQuery.eq).toHaveBeenCalledWith("id", "contract-1");
    expect(contractQuery.is).toHaveBeenCalledWith("deleted_at", null);
    expect(updateTable.update).toHaveBeenCalledWith({ clauses: validClauses });
    expect(updateTable.update.mock.calls[0][0]).not.toHaveProperty("user_id");
    expect(updateTable.update.mock.calls[0][0]).not.toHaveProperty("status");
    expect(updateTable.update.mock.calls[0][0]).not.toHaveProperty("doc_hash");
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");
    expect(revalidatePath).toHaveBeenCalledWith("/contracts/contract-1");
  });

  it("rejects clause edits after the contract leaves draft status", async () => {
    const contractQuery = createMaybeSingleQuery({ id: "contract-1", status: "signed" });
    const updateTable = createUpdateTableMock();
    const supabase = {
      from: vi.fn((table: string) =>
        table === "contracts" &&
        supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? contractQuery
          : updateTable,
      ),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await updateContractClauses("contract-1", {
      clauses: validClauses,
    });

    expect(result).toEqual({
      ok: false,
      error: "초안 상태의 계약만 조항을 편집할 수 있습니다.",
    });
    expect(updateTable.update).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalledWith("/contracts/contract-1");
  });

  it("rejects clause edits when the contract is not owned by the user", async () => {
    const contractQuery = createMaybeSingleQuery(null);
    const updateTable = createUpdateTableMock();
    const supabase = {
      from: vi.fn((table: string) =>
        table === "contracts" &&
        supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? contractQuery
          : updateTable,
      ),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await updateContractClauses("contract-1", {
      clauses: validClauses,
    });

    expect(result).toEqual({
      ok: false,
      error: "계약을 찾을 수 없습니다.",
    });
    expect(updateTable.update).not.toHaveBeenCalled();
  });

  it("rejects invalid contract status transitions before writing", async () => {
    const contractQuery = createContractStatusReadQuery("draft");
    const updateTable = createUpdateTableMock();
    const eventTable = createEventInsertTableMock();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "contract_events") return eventTable;

        return supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? contractQuery
          : updateTable;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await transitionContractStatus("contract-1", "done");

    expect(result).toEqual({
      ok: false,
      error: "허용되지 않는 계약 상태 전이입니다.",
    });
    expect(updateTable.update).not.toHaveBeenCalled();
    expect(eventTable.insert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalledWith("/contracts/contract-1");
  });

  it("updates the contract status before appending a transition event", async () => {
    const calls: string[] = [];
    const contractQuery = createContractStatusReadQuery("signed");
    const updateTable = createUpdateTableMock();
    updateTable.update.mockImplementation((payload) => {
      calls.push("contracts.update");

      expect(payload).toEqual({ status: "active" });

      return {
        eq: updateTable.eq,
        select: updateTable.select,
        single: updateTable.single,
      };
    });
    const eventTable = createEventInsertTableMock();
    eventTable.insert.mockImplementation((payload) => {
      calls.push("contract_events.insert");

      expect(payload).toEqual({
        user_id: user.id,
        contract_id: "contract-1",
        actor: user.id,
        from_status: "signed",
        to_status: "active",
        event_type: "contract.status_changed",
        meta: {
          reset_signature_artifacts: false,
        },
      });

      return Promise.resolve({ error: null });
    });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "contract_events") return eventTable;

        return supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? contractQuery
          : updateTable;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await transitionContractStatus("contract-1", "active");

    expect(result).toEqual({ ok: true, id: "contract-1" });
    expect(calls).toEqual(["contracts.update", "contract_events.insert"]);
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");
    expect(revalidatePath).toHaveBeenCalledWith("/contracts/contract-1");
  });

  it("clears signature artifacts when rolling a signed contract back to draft", async () => {
    const contractQuery = createContractStatusReadQuery("signed");
    const updateTable = createUpdateTableMock();
    const eventTable = createEventInsertTableMock();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "contract_events") return eventTable;

        return supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? contractQuery
          : updateTable;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await transitionContractStatus("contract-1", "draft");

    expect(result).toEqual({ ok: true, id: "contract-1" });
    expect(updateTable.update).toHaveBeenCalledWith({
      status: "draft",
      signature_meta: null,
      doc_hash: null,
      signature_image_path: null,
    });
    expect(eventTable.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        from_status: "signed",
        to_status: "draft",
        meta: {
          reset_signature_artifacts: true,
        },
      }),
    );
  });

  it.each([
    ["빈 제목", { title: " " }],
    ["음수 금액", { amount: -1 }],
    ["종료일이 시작일보다 빠른 기간", { end_date: "2026-07-31" }],
    ["누락된 필수 조항", { clauses: validClauses.slice(0, 9) }],
  ])("rejects imported contract validation for %s", async (_case, override) => {
    const insertTable = createInsertTableMock();
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn().mockReturnValue(insertTable),
      storage: {
        from: vi.fn(),
      },
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const result = await createImportedContract(
      createImportedContractFormData({
        ...validInput,
        title: "기존 계약서",
        clauses: validClauses,
        ...override,
      }),
    );

    expect(result.ok).toBe(false);
    expect(assertOwned).not.toHaveBeenCalled();
    expect(insertTable.insert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects imported contracts for a client_id not owned by the user", async () => {
    vi.mocked(assertOwned).mockResolvedValue(false);
    const insertTable = createInsertTableMock();
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn().mockReturnValue(insertTable),
      storage: {
        from: vi.fn(),
      },
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const result = await createImportedContract(
      createImportedContractFormData(
        {
          ...validInput,
          title: "기존 계약서",
          clauses: validClauses,
        },
        createSourcePdfFile(),
      ),
    );

    expect(result).toEqual({
      ok: false,
      error: "클라이언트를 찾을 수 없습니다.",
    });
    expect(insertTable.insert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates an imported contract that lands signed with the source PDF hash and stores only the source PDF key", async () => {
    const expectedDocHash =
      createV1SignatureProvider().computeFileHash(SOURCE_PDF_BYTES);
    const calls: string[] = [];
    const contractsInsert = createInsertTableMock("imported-contract-1");
    contractsInsert.insert.mockImplementation((payload) => {
      calls.push("contracts.insert");

      expect(payload).toEqual({
        user_id: user.id,
        client_id: validInput.client_id,
        title: "기존 계약서",
        scope: validInput.scope,
        amount: validInput.amount,
        start_date: validInput.start_date,
        end_date: validInput.end_date,
        status: "signed",
        clauses: validClauses,
        doc_hash: expectedDocHash,
      });
      expect(payload).not.toHaveProperty("source_pdf_url");
      expect(payload).not.toHaveProperty("signature_meta");

      return {
        select: contractsInsert.select,
        single: contractsInsert.single,
      };
    });
    const contractsUpdate = {
      update: vi.fn((payload) => {
        calls.push("contracts.update_source_pdf");
        expect(payload).toEqual({
          source_pdf_url: `${user.id}/imported-contract-1/source.pdf`,
        });

        return {
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    };
    const eventTable = createEventInsertTableMock();
    eventTable.insert.mockImplementation((payload) => {
      calls.push("contract_events.insert");

      expect(payload).toEqual({
        user_id: user.id,
        contract_id: "imported-contract-1",
        actor: user.id,
        from_status: null,
        to_status: "signed",
        event_type: "contract.imported",
        meta: { source: "pdf_import" },
      });

      return Promise.resolve({ error: null });
    });
    const storageUpload = vi.fn().mockImplementation((key) => {
      calls.push("storage.upload");
      expect(key).toBe(`${user.id}/imported-contract-1/source.pdf`);

      return Promise.resolve({ error: null });
    });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "contract_events") return eventTable;

        return supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? contractsInsert
          : contractsUpdate;
      }),
      storage: {
        from: vi.fn().mockReturnValue({ upload: storageUpload }),
      },
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await createImportedContract(
      createImportedContractFormData(
        {
          ...validInput,
          title: "기존 계약서",
          clauses: validClauses,
          user_id: "attacker-user",
          status: "draft",
          source_pdf_url: "https://attacker.example/source.pdf",
          doc_hash: "spoofed",
        },
        createSourcePdfFile(),
      ),
    );

    expect(result).toEqual({ ok: true, id: "imported-contract-1" });
    expect(assertOwned).toHaveBeenCalledWith(
      supabase,
      "clients",
      validInput.client_id,
    );
    expect(supabase.storage.from).toHaveBeenCalledWith("contract-artifacts");
    expect(storageUpload).toHaveBeenCalledWith(
      `${user.id}/imported-contract-1/source.pdf`,
      expect.any(Buffer),
      { contentType: "application/pdf", upsert: true },
    );
    expect(calls).toEqual([
      "contracts.insert",
      "storage.upload",
      "contracts.update_source_pdf",
      "contract_events.insert",
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");
  });

  it("rejects an imported contract when the source PDF is missing", async () => {
    const insertTable = createInsertTableMock();
    const storageFrom = vi.fn();
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn().mockReturnValue(insertTable),
      storage: {
        from: storageFrom,
      },
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const result = await createImportedContract(
      createImportedContractFormData({
        ...validInput,
        title: "기존 계약서",
        clauses: validClauses,
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: "원본 계약서 PDF를 업로드해 주세요.",
    });
    expect(assertOwned).not.toHaveBeenCalled();
    expect(insertTable.insert).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

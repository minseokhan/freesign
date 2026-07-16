import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GENERIC_ACTION_ERROR } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { generateContractDraft } from "@/services/ai/contract-draft";
import { createV1SignatureProvider } from "@/services/signature/provider";

import {
  createContractDraft,
  createImportedContract,
  deleteContract,
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
    limit: vi.fn().mockReturnThis(),
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

function createRpcMock() {
  return vi.fn().mockResolvedValue({ data: "contract-1", error: null });
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

  it("transitions contract status through an atomic RPC", async () => {
    const contractQuery = createContractStatusReadQuery("signed");
    const rpc = createRpcMock();
    const supabase = {
      from: vi.fn(() => contractQuery),
      rpc,
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await transitionContractStatus("contract-1", "active");

    expect(result).toEqual({ ok: true, id: "contract-1" });
    expect(rpc).toHaveBeenCalledWith("transition_contract_status_with_event", {
      p_contract_id: "contract-1",
      p_to_status: "active",
      p_reset_signature_artifacts: false,
      p_actor: user.id,
      p_event_type: "contract.status_changed",
      p_meta: {
        reset_signature_artifacts: false,
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");
    expect(revalidatePath).toHaveBeenCalledWith("/contracts/contract-1");
  });

  it("clears signature artifacts when rolling a signed contract back to draft", async () => {
    const contractQuery = createContractStatusReadQuery("signed");
    // 맞서명 없음 → draft 되돌리기 허용.
    const counterpartyQuery = createMaybeSingleQuery(null);
    const rpc = createRpcMock();
    const supabase = {
      from: vi.fn((table: string) =>
        table === "contract_signatures" ? counterpartyQuery : contractQuery,
      ),
      rpc,
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await transitionContractStatus("contract-1", "draft");

    expect(result).toEqual({ ok: true, id: "contract-1" });
    expect(rpc).toHaveBeenCalledWith(
      "transition_contract_status_with_event",
      expect.objectContaining({
        p_to_status: "draft",
        p_reset_signature_artifacts: true,
        p_actor: user.id,
        p_event_type: "contract.status_changed",
        p_meta: {
          reset_signature_artifacts: true,
        },
      }),
    );
  });

  it("blocks rolling back to draft when a counterparty signature exists", async () => {
    const contractQuery = createContractStatusReadQuery("signed");
    // 맞서명 존재 → draft 되돌리기는 무효화(취소)로 유도한다(DB 이중 가드와 동일 규칙).
    const counterpartyQuery = createMaybeSingleQuery({ id: "signature-1" });
    const rpc = createRpcMock();
    const supabase = {
      from: vi.fn((table: string) =>
        table === "contract_signatures" ? counterpartyQuery : contractQuery,
      ),
      rpc,
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const result = await transitionContractStatus("contract-1", "draft");

    expect(result).toEqual({
      ok: false,
      error:
        "맞서명이 완료된 계약은 초안으로 되돌릴 수 없습니다. 대신 '취소'로 무효화하세요.",
    });
    expect(counterpartyQuery.eq).toHaveBeenCalledWith("party", "counterparty");
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
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

  it("creates an imported contract through source upload and an atomic RPC", async () => {
    const expectedDocHash =
      createV1SignatureProvider().computeFileHash(SOURCE_PDF_BYTES);
    const calls: string[] = [];
    const rpc = vi.fn().mockImplementation((fnName, args) => {
      calls.push("contracts.rpc_import");
      expect(fnName).toBe("import_signed_contract_with_event");
      expect(args).toMatchObject({
        p_client_id: validInput.client_id,
        p_title: "기존 계약서",
        p_scope: validInput.scope,
        p_amount: validInput.amount,
        p_start_date: validInput.start_date,
        p_end_date: validInput.end_date,
        p_clauses: validClauses,
        p_plain_summary: null,
        p_doc_hash: expectedDocHash,
        p_actor: user.id,
        p_event_type: "contract.imported",
        p_meta: { source: "pdf_import" },
      });
      expect(args.p_contract_id).toEqual(expect.any(String));
      expect(args.p_source_pdf_url).toBe(`${user.id}/${args.p_contract_id}/source.pdf`);

      return Promise.resolve({ data: args.p_contract_id, error: null });
    });
    const storageUpload = vi.fn().mockImplementation((key) => {
      calls.push("storage.upload");
      expect(key).toMatch(new RegExp(`^${user.id}/.+/source\\.pdf$`));

      return Promise.resolve({ error: null });
    });
    const supabase = {
      from: vi.fn(),
      rpc,
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

    expect(result).toEqual({ ok: true, id: expect.any(String) });
    expect(assertOwned).toHaveBeenCalledWith(
      supabase,
      "clients",
      validInput.client_id,
    );
    expect(supabase.storage.from).toHaveBeenCalledWith("contract-artifacts");
    expect(storageUpload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${user.id}/.+/source\\.pdf$`)),
      expect.any(Buffer),
      { contentType: "application/pdf", upsert: true },
    );
    expect(calls).toEqual(["storage.upload", "contracts.rpc_import"]);
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");
  });

  it("rejects an imported contract when source PDF upload fails before DB writes", async () => {
    const rpc = createRpcMock();
    const storageUpload = vi.fn().mockResolvedValue({
      error: { message: "storage unavailable" },
    });
    const supabase = {
      from: vi.fn(),
      rpc,
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
        },
        createSourcePdfFile(),
      ),
    );

    expect(result).toEqual({ ok: false, error: GENERIC_ACTION_ERROR });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
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

  function createHardDeleteMocks(
    contractOverride: Record<string, unknown> = {},
    storageRemoveError: { message: string } | null = null,
    counterpartySignature: Record<string, unknown> | null = null,
  ) {
    const calls: string[] = [];
    const contractData = {
      title: "삭제될 계약",
      amount: 3_000_000,
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      contract_pdf_url: "user-123/contract-1/contract.pdf",
      signature_image_path: "user-123/contract-1/signature.png",
      source_pdf_url: null,
      ...contractOverride,
    };
    const counterpartyQuery = createMaybeSingleQuery(counterpartySignature);
    const readQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: contractData, error: null }),
    };
    const invoiceUpdateEq = vi.fn().mockImplementation(() => {
      calls.push("invoices.snapshot");
      return Promise.resolve({ error: null });
    });
    const invoiceUpdate = vi.fn().mockReturnValue({ eq: invoiceUpdateEq });
    const deleteEq = vi.fn().mockImplementation(() => {
      calls.push("contracts.delete");
      return Promise.resolve({ error: null });
    });
    const contractDelete = vi.fn().mockReturnValue({ eq: deleteEq });
    const remove = vi.fn().mockImplementation(() => {
      calls.push("storage.remove");
      return Promise.resolve({ error: storageRemoveError });
    });
    const storageFrom = vi.fn().mockReturnValue({ remove });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "contract_signatures") return counterpartyQuery;
        if (table === "invoices") return { update: invoiceUpdate };
        const contractCalls = supabase.from.mock.calls.filter(
          ([name]) => name === "contracts",
        ).length;
        return contractCalls === 1 ? readQuery : { delete: contractDelete };
      }),
      storage: { from: storageFrom },
    };

    return {
      calls,
      supabase,
      counterpartyQuery,
      invoiceUpdate,
      invoiceUpdateEq,
      contractDelete,
      deleteEq,
      storageFrom,
      remove,
    };
  }

  it("blocks deletion when a counterparty signature exists and suggests cancellation", async () => {
    const mocks = createHardDeleteMocks({}, null, { id: "signature-1" });
    vi.mocked(createSupabaseClient).mockResolvedValue(
      mocks.supabase as unknown as Awaited<
        ReturnType<typeof createSupabaseClient>
      >,
    );

    const result = await deleteContract("contract-1");

    expect(result).toEqual({
      ok: false,
      error:
        "맞서명이 완료된 계약은 삭제할 수 없습니다. 대신 '취소'로 무효화하세요.",
    });
    expect(mocks.counterpartyQuery.eq).toHaveBeenCalledWith(
      "party",
      "counterparty",
    );
    // 삭제 절차(스냅샷·물리 삭제·Storage 정리)가 하나도 실행되지 않아야 한다.
    expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
    expect(mocks.contractDelete).not.toHaveBeenCalled();
    expect(mocks.storageFrom).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("hard-deletes a contract: snapshots invoices, deletes the row, then removes storage artifacts in order", async () => {
    const mocks = createHardDeleteMocks();
    vi.mocked(createSupabaseClient).mockResolvedValue(
      mocks.supabase as unknown as Awaited<
        ReturnType<typeof createSupabaseClient>
      >,
    );

    const result = await deleteContract("contract-1");

    expect(result).toEqual({ ok: true, id: "contract-1" });
    expect(assertOwned).toHaveBeenCalledWith(
      mocks.supabase,
      "contracts",
      "contract-1",
    );
    expect(mocks.invoiceUpdate).toHaveBeenCalledWith({
      contract_snapshot: {
        title: "삭제될 계약",
        amount: 3_000_000,
        start_date: "2026-08-01",
        end_date: "2026-08-31",
      },
    });
    expect(mocks.invoiceUpdateEq).toHaveBeenCalledWith("contract_id", "contract-1");
    expect(mocks.deleteEq).toHaveBeenCalledWith("id", "contract-1");
    expect(mocks.storageFrom).toHaveBeenCalledWith("contract-artifacts");
    // 원본 PDF 키(source_pdf_url)는 null이라 제거 대상에서 제외된다.
    expect(mocks.remove).toHaveBeenCalledWith([
      "user-123/contract-1/contract.pdf",
      "user-123/contract-1/signature.png",
    ]);
    // 순서: 스냅샷(계약 살아있을 때) → 물리 삭제(정본) → Storage 정리.
    expect(mocks.calls).toEqual([
      "invoices.snapshot",
      "contracts.delete",
      "storage.remove",
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/invoices");
  });

  it("still succeeds when storage cleanup fails after the row is deleted", async () => {
    const mocks = createHardDeleteMocks({}, { message: "storage unavailable" });
    vi.mocked(createSupabaseClient).mockResolvedValue(
      mocks.supabase as unknown as Awaited<
        ReturnType<typeof createSupabaseClient>
      >,
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await deleteContract("contract-1");

    expect(result).toEqual({ ok: true, id: "contract-1" });
    expect(mocks.calls).toEqual([
      "invoices.snapshot",
      "contracts.delete",
      "storage.remove",
    ]);
    expect(consoleError).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");

    consoleError.mockRestore();
  });

  it("skips storage removal when the contract has no stored artifacts", async () => {
    const mocks = createHardDeleteMocks({
      contract_pdf_url: null,
      signature_image_path: null,
      source_pdf_url: null,
    });
    vi.mocked(createSupabaseClient).mockResolvedValue(
      mocks.supabase as unknown as Awaited<
        ReturnType<typeof createSupabaseClient>
      >,
    );

    const result = await deleteContract("contract-1");

    expect(result).toEqual({ ok: true, id: "contract-1" });
    expect(mocks.storageFrom).not.toHaveBeenCalled();
    expect(mocks.calls).toEqual(["invoices.snapshot", "contracts.delete"]);
  });

  it("rejects contract deletion when ownership check fails", async () => {
    const from = vi.fn();
    const supabase = {
      from,
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>;
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase);
    vi.mocked(assertOwned).mockResolvedValueOnce(false);

    const result = await deleteContract("contract-1");

    expect(result).toEqual({ ok: false, error: "계약을 찾을 수 없습니다." });
    expect(from).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

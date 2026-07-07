import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createV1SignatureProvider } from "@/services/signature/provider";

import { POST } from "../route";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/services/signature/provider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/signature/provider")>();

  return {
    ...actual,
    createV1SignatureProvider: vi.fn(),
  };
});

const user = { id: "user-123", email: "freelancer@example.test" };
const clauses = [
  {
    title: "용역 범위",
    body: "랜딩 페이지 디자인",
    plain_summary: "디자인 작업을 수행합니다.",
    needs_review: false,
  },
];

function createContractReadQuery(status = "draft") {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "contract-1",
        status,
        clauses,
      },
      error: null,
    }),
  };
}

function createUpdateQuery(calls: string[]) {
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  const single = vi.fn().mockImplementation(() => {
    calls.push("contract.update.single");

    return Promise.resolve({ data: { id: "contract-1" }, error: null });
  });
  const update = vi.fn().mockImplementation((payload) => {
    calls.push(`contract.update:${payload.status}`);

    return { eq, select, single };
  });

  return { update, eq, select, single };
}

function createEventInsertQuery(calls: string[]) {
  return {
    insert: vi.fn().mockImplementation(() => {
      calls.push("contract_events.insert");

      return Promise.resolve({ error: null });
    }),
  };
}

function createStorage(calls: string[]) {
  const upload = vi.fn().mockImplementation(() => {
    calls.push("storage.upload");

    return Promise.resolve({ data: { path: "user-123/contract-1/signature.png" }, error: null });
  });
  const from = vi.fn().mockReturnValue({ upload });

  return { from, upload };
}

function createRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/contracts/contract-1/sign", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Vitest Browser",
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    },
    body: JSON.stringify({
      signatureDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      ...body,
    }),
  });
}

describe("POST /api/contracts/[id]/sign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(createV1SignatureProvider).mockReturnValue({
      computeDocHash: vi.fn().mockReturnValue("provider-doc-hash"),
      createSignatureResult: vi.fn(),
    });
  });

  it("uploads the signature and computes the provider hash before signing the contract", async () => {
    const calls: string[] = [];
    const contractRead = createContractReadQuery();
    const contractUpdate = createUpdateQuery(calls);
    const eventInsert = createEventInsertQuery(calls);
    const storage = createStorage(calls);
    const supabase = {
      storage,
      from: vi.fn((table: string) => {
        if (table === "contract_events") return eventInsert;

        return supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? contractRead
          : contractUpdate;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: "contract-1" }),
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      "storage.upload",
      "contract.update:signed",
      "contract.update.single",
      "contract_events.insert",
    ]);
    expect(storage.from).toHaveBeenCalledWith("contract-artifacts");
    expect(storage.upload).toHaveBeenCalledWith(
      "user-123/contract-1/signature.png",
      expect.any(Uint8Array),
      expect.objectContaining({
        contentType: "image/png",
        upsert: true,
      }),
    );
    expect(createV1SignatureProvider).toHaveBeenCalled();
    expect(
      vi.mocked(createV1SignatureProvider).mock.results[0].value.computeDocHash,
    ).toHaveBeenCalledWith(clauses);
    expect(contractUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "signed",
        signature_image_path: "user-123/contract-1/signature.png",
        doc_hash: "provider-doc-hash",
        signature_meta: expect.objectContaining({
          signer: "freelancer@example.test",
          ip: "203.0.113.10",
          ua: "Vitest Browser",
        }),
      }),
    );
    expect(eventInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-123",
        contract_id: "contract-1",
        actor: "user-123",
        from_status: "draft",
        to_status: "signed",
        event_type: "signed",
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/contracts");
    expect(revalidatePath).toHaveBeenCalledWith("/contracts/contract-1");
  });

  it("ignores client-supplied server-owned signature fields", async () => {
    const calls: string[] = [];
    const contractUpdate = createUpdateQuery(calls);
    const supabase = {
      storage: createStorage(calls),
      from: vi.fn((table: string) => {
        if (table === "contract_events") return createEventInsertQuery(calls);

        return supabase.from.mock.calls.filter(([name]) => name === "contracts")
          .length === 1
          ? createContractReadQuery()
          : contractUpdate;
      }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const response = await POST(
      createRequest({
        status: "done",
        doc_hash: "client-doc-hash",
        signature_image_path: "public-url",
        signature_meta: {
          signer: "attacker",
          ip: "198.51.100.20",
          ua: "Forged UA",
        },
      }),
      {
        params: Promise.resolve({ id: "contract-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(contractUpdate.update.mock.calls[0][0]).toMatchObject({
      status: "signed",
      doc_hash: "provider-doc-hash",
      signature_image_path: "user-123/contract-1/signature.png",
      signature_meta: expect.objectContaining({
        signer: "freelancer@example.test",
        ip: "203.0.113.10",
        ua: "Vitest Browser",
      }),
    });
  });

  it("rejects signing when the contract is not in draft status", async () => {
    const calls: string[] = [];
    const supabase = {
      storage: createStorage(calls),
      from: vi.fn(() => createContractReadQuery("active")),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
    );

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: "contract-1" }),
    });

    expect(response.status).toBe(409);
    expect(supabase.storage.upload).not.toHaveBeenCalled();
    expect(createV1SignatureProvider).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { EXPORT_TABLES } from "@/lib/account-export";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { GET } from "../route";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();

  return { ...actual, checkRateLimit: vi.fn() };
});

vi.mock("@/lib/posthog-server", () => ({
  captureServerException: vi.fn(),
  getPostHogClient: () => ({ capture: vi.fn(), flush: vi.fn() }),
}));

const user = { id: "user-123", email: "freelancer@example.test" };

/** 테이블별로 지정한 행을 돌려주는 Supabase 스텁. */
function stubSupabase(rowsByTable: Record<string, unknown[]>, error?: Error) {
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockResolvedValue({
      data: error ? null : (rowsByTable[table] ?? []),
      error: error ?? null,
    }),
  }));

  vi.mocked(createSupabaseClient).mockResolvedValue(
    { from } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>,
  );

  return from;
}

describe("GET /api/account/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
  });

  it("보관 중인 모든 테이블을 JSON 첨부로 내려준다", async () => {
    const from = stubSupabase({
      clients: [{ id: "client-1", name: "김클라" }],
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="maedeup-data-.*\.json"$/,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const payload = await response.json();

    for (const spec of EXPORT_TABLES) {
      expect(from).toHaveBeenCalledWith(spec.table);
      expect(payload.data).toHaveProperty(spec.table);
    }
    expect(payload.data.clients).toEqual([{ id: "client-1", name: "김클라" }]);
    expect(payload.account.id).toBe(user.id);
  });

  it("서명 토큰 해시와 TSA 토큰은 내보내지 않는다", async () => {
    stubSupabase({
      signature_requests: [
        {
          id: "req-1",
          recipient_email: "client@example.test",
          token_hash: "a".repeat(64),
          sent_tsa_token: "SENT_TOKEN",
          completion_tsa_token: "DONE_TOKEN",
        },
      ],
    });

    const response = await GET();
    const payload = await response.json();
    const [request] = payload.data.signature_requests;

    expect(request.recipient_email).toBe("client@example.test");
    expect(request).not.toHaveProperty("token_hash");
    expect(request).not.toHaveProperty("sent_tsa_token");
    expect(request).not.toHaveProperty("completion_tsa_token");
    expect(JSON.stringify(payload)).not.toContain("a".repeat(64));
  });

  it("서명 이미지 원본 바이트는 제외하고 경로만 남긴다", async () => {
    stubSupabase({
      contract_signatures: [
        {
          id: "sig-1",
          signature_image_path: "user-123/sig.png",
          signature_image_data: "BASE64_PAYLOAD",
        },
      ],
    });

    const response = await GET();
    const payload = await response.json();
    const [signature] = payload.data.contract_signatures;

    expect(signature.signature_image_path).toBe("user-123/sig.png");
    expect(signature).not.toHaveProperty("signature_image_data");
  });

  it("상한을 넘으면 429로 막는다", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      retryAfter: 3600,
    });
    const from = stubSupabase({});

    const response = await GET();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(from).not.toHaveBeenCalled();
  });

  it("조회에 실패하면 내부 오류를 노출하지 않고 500으로 응답한다", async () => {
    stubSupabase({}, new Error("relation does not exist"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("relation");
  });

  it("플랜 게이트를 걸지 않는다 (열람권은 요금제로 제한할 수 없다)", async () => {
    stubSupabase({});

    const response = await GET();

    expect(response.status).toBe(200);
  });
});

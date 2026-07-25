import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { assertProFeature } from "@/lib/plan";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { generateContractInsight } from "@/services/ai/contract-insight";

import { POST } from "../route";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/plan", () => ({ assertProFeature: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/services/ai/contract-insight", () => ({ generateContractInsight: vi.fn() }));
vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: () => ({ capture: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }),
  captureServerException: vi.fn(),
}));

const user = { id: "user-1", email: "me@test" };
const contractId = "11111111-1111-4111-8111-111111111111";
const params = Promise.resolve({ id: contractId });

function contractQuery(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function insightInsert() {
  return { insert: vi.fn().mockReturnValue({ error: null }) };
}

describe("POST /api/contracts/[id]/insights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(user as never);
    vi.mocked(assertProFeature).mockResolvedValue({ ok: true, plan: "pro" });
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
    vi.mocked(generateContractInsight).mockResolvedValue({
      summary: "요약",
      risk_level: "medium",
      findings: [],
      model: "claude-sonnet-5",
      source: "ai",
    });
  });

  it("free 플랜이면 402 + upsell", async () => {
    vi.mocked(assertProFeature).mockResolvedValue({
      ok: false, plan: "free", reason: "pro_only", message: "Pro 전용",
    });

    const res = await POST(new Request("http://t/api"), { params });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.upsell).toBe(true);
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it("pro면 인사이트를 생성·저장하고 200 반환", async () => {
    const insertBuilder = insightInsert();
    const supabase = {
      from: vi.fn((t: string) =>
        t === "contracts"
          ? contractQuery({ id: contractId, title: "계약", clauses: [], plain_summary: "요약" })
          : insertBuilder,
      ),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase as never);

    const res = await POST(new Request("http://t/api", { method: "POST" }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.insight.risk_level).toBe("medium");
    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ contract_id: contractId, source: "ai" }),
    );
  });

  it("존재하지 않는 계약이면 404", async () => {
    const supabase = { from: vi.fn(() => contractQuery(null)) };
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase as never);

    const res = await POST(new Request("http://t/api", { method: "POST" }), { params });
    expect(res.status).toBe(404);
  });

  it("rate limit 초과면 429", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfter: 60 });
    const supabase = {
      from: vi.fn(() => contractQuery({ id: contractId, title: "계약", clauses: [], plain_summary: null })),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase as never);

    const res = await POST(new Request("http://t/api", { method: "POST" }), { params });
    expect(res.status).toBe(429);
    expect(generateContractInsight).not.toHaveBeenCalled();
  });
});

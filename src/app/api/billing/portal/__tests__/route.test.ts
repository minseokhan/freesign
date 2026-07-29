import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerPortal } from "@polar-sh/nextjs";
import { requireUser } from "@/lib/auth";
import { getPolarEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

import { GET } from "../route";

vi.mock("@polar-sh/nextjs", () => ({
  CustomerPortal: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getPolarEnv: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

function mockSubscription(polarCustomerId: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: polarCustomerId ? { polar_customer_id: polarCustomerId } : null,
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createClient).mockResolvedValue({ from } as unknown as Awaited<
    ReturnType<typeof createClient>
  >);
}

describe("GET /api/billing/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      id: "user-1",
    } as Awaited<ReturnType<typeof requireUser>>);
    vi.mocked(getPolarEnv).mockReturnValue({
      POLAR_ACCESS_TOKEN: "tok",
      POLAR_WEBHOOK_SECRET: "whsec",
      POLAR_PRODUCT_ID: "prod",
      POLAR_SERVER: "sandbox",
    });
  });

  it("구독 행의 polar_customer_id를 CustomerPortal에 넘긴다", async () => {
    mockSubscription("cus_42");
    let capturedGetCustomerId:
      | ((req: NextRequest) => Promise<string>)
      | undefined;
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 307 }));
    vi.mocked(CustomerPortal).mockImplementation((config) => {
      capturedGetCustomerId = (
        config as { getCustomerId: (req: NextRequest) => Promise<string> }
      ).getCustomerId;
      return handler;
    });

    const req = new NextRequest("https://freesign.example/api/billing/portal");
    await GET(req);

    expect(handler).toHaveBeenCalled();
    const customerId = await capturedGetCustomerId?.(req);
    expect(customerId).toBe("cus_42");
  });

  it("구독 고객 id가 없으면 Polar를 부르지 않고 요금제 페이지로 되돌린다", async () => {
    mockSubscription(null);

    const req = new NextRequest("https://freesign.example/api/billing/portal");
    const response = await GET(req);

    expect(CustomerPortal).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://freesign.example/billing?portal=no_customer",
    );
  });

  // 토큰 스코프 부족 등으로 포털 생성이 실패해도 빈 화면 대신 사유를 안고 돌아와야 한다.
  it("포털 호출이 실패하면 사유와 함께 요금제 페이지로 되돌린다", async () => {
    mockSubscription("cus_42");
    vi.mocked(CustomerPortal).mockImplementation(() =>
      vi.fn().mockRejectedValue(new Error("insufficient_scope")),
    );

    const req = new NextRequest("https://freesign.example/api/billing/portal");
    const response = await GET(req);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://freesign.example/billing?portal=portal_failed",
    );
  });
});

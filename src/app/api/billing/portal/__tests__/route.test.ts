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

  it("구독 고객 id가 없으면 getCustomerId가 예외를 던진다", async () => {
    mockSubscription(null);
    let capturedGetCustomerId:
      | ((req: NextRequest) => Promise<string>)
      | undefined;
    vi.mocked(CustomerPortal).mockImplementation((config) => {
      capturedGetCustomerId = (
        config as { getCustomerId: (req: NextRequest) => Promise<string> }
      ).getCustomerId;
      return vi.fn().mockResolvedValue(new Response());
    });

    const req = new NextRequest("https://freesign.example/api/billing/portal");
    await GET(req);

    await expect(capturedGetCustomerId?.(req)).rejects.toThrow();
  });
});

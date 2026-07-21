import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Checkout } from "@polar-sh/nextjs";
import { requireUser } from "@/lib/auth";
import { getPolarEnv } from "@/lib/env";

import { GET } from "../route";

vi.mock("@polar-sh/nextjs", () => ({
  Checkout: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getPolarEnv: vi.fn(),
}));

vi.mock("@/lib/seo", () => ({
  getSiteUrl: () => "https://freesign.example",
}));

describe("GET /api/billing/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      id: "user-1",
      email: "me@example.test",
    } as Awaited<ReturnType<typeof requireUser>>);
    vi.mocked(getPolarEnv).mockReturnValue({
      POLAR_ACCESS_TOKEN: "tok",
      POLAR_WEBHOOK_SECRET: "whsec",
      POLAR_PRODUCT_ID: "prod-123",
      POLAR_SERVER: "sandbox",
    });
  });

  it("상품·고객 식별을 서버에서 주입해 Polar Checkout 핸들러로 넘긴다", async () => {
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 307 }));
    vi.mocked(Checkout).mockReturnValue(handler);

    await GET(new NextRequest("https://freesign.example/api/billing/checkout"));

    expect(Checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "tok",
        server: "sandbox",
        successUrl: "https://freesign.example/settings?checkout=success",
      }),
    );

    const passedReq = handler.mock.calls[0][0] as NextRequest;
    const params = new URL(passedReq.url).searchParams;
    expect(params.get("products")).toBe("prod-123");
    expect(params.get("customerExternalId")).toBe("user-1");
    expect(params.get("customerEmail")).toBe("me@example.test");
  });
});

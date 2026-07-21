import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPolarEnv } from "@/lib/env";
import { createAnonClient } from "@/lib/supabase/anon";

import { applySubscriptionEvent } from "@/lib/billing-webhook";

vi.mock("@/lib/env", () => ({
  getPolarEnv: vi.fn(),
}));

vi.mock("@/lib/supabase/anon", () => ({
  createAnonClient: vi.fn(),
}));

const baseSubscription = {
  id: "sub_1",
  status: "active",
  customerId: "cus_1",
  currentPeriodEnd: "2026-08-21T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  customer: { externalId: "user-1" },
};

describe("applySubscriptionEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPolarEnv).mockReturnValue({
      POLAR_ACCESS_TOKEN: "tok",
      POLAR_WEBHOOK_SECRET: "whsec",
      POLAR_PRODUCT_ID: "prod",
      POLAR_SERVER: "sandbox",
    });
  });

  it("anon 클라이언트로 upsert_subscription_from_polar RPC를 호출한다", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createAnonClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createAnonClient>);

    await applySubscriptionEvent(baseSubscription, "subscription.active");

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("upsert_subscription_from_polar");
    expect(args).toMatchObject({
      p_webhook_secret: "whsec",
      p_user_id: "user-1",
      p_plan: "pro",
      p_status: "active",
      p_event_type: "subscription.active",
    });
  });

  it("revoked 이벤트는 free·revoked로 강등해 호출한다", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createAnonClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createAnonClient>);

    await applySubscriptionEvent(baseSubscription, "subscription.revoked", true);

    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_plan: "free",
      p_status: "revoked",
    });
  });

  it("externalId가 없으면 RPC를 호출하지 않는다(소유자 특정 불가)", async () => {
    const rpc = vi.fn();
    vi.mocked(createAnonClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createAnonClient>);

    await applySubscriptionEvent(
      { ...baseSubscription, customer: { externalId: null } },
      "subscription.active",
    );

    expect(rpc).not.toHaveBeenCalled();
  });
});

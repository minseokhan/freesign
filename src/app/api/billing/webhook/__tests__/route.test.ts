import { beforeEach, describe, expect, it, vi } from "vitest";

import { Webhooks } from "@polar-sh/nextjs";
import { applySubscriptionEvent } from "@/lib/billing-webhook";

// Webhooks 어댑터·핸들러 로직은 각각 순수 유닛으로 검증하고, 여기선 라우트 배선만 확인한다.
vi.mock("@polar-sh/nextjs", () => ({
  Webhooks: vi.fn(() => "POST_HANDLER"),
}));

vi.mock("@/lib/billing-webhook", () => ({
  applySubscriptionEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("POST /api/billing/webhook 배선", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("구독 이벤트 4종을 applySubscriptionEvent로 연결하고 revoked만 강등 플래그를 준다", async () => {
    const { POST } = await import("../route");
    expect(POST).toBe("POST_HANDLER");

    const config = vi.mocked(Webhooks).mock.calls[0][0];

    const subscription = { id: "sub_1" };
    await config.onSubscriptionActive?.({ data: subscription } as never);
    await config.onSubscriptionUpdated?.({ data: subscription } as never);
    await config.onSubscriptionCanceled?.({ data: subscription } as never);
    await config.onSubscriptionRevoked?.({ data: subscription } as never);

    expect(applySubscriptionEvent).toHaveBeenNthCalledWith(
      1,
      subscription,
      "subscription.active",
    );
    expect(applySubscriptionEvent).toHaveBeenNthCalledWith(
      2,
      subscription,
      "subscription.updated",
    );
    expect(applySubscriptionEvent).toHaveBeenNthCalledWith(
      3,
      subscription,
      "subscription.canceled",
    );
    expect(applySubscriptionEvent).toHaveBeenNthCalledWith(
      4,
      subscription,
      "subscription.revoked",
      true,
    );
  });
});

import { buildSubscriptionRpcArgs, type PolarSubscriptionLike } from "@/lib/billing";

function subscription(
  overrides: Partial<PolarSubscriptionLike> = {},
): PolarSubscriptionLike {
  return {
    id: "sub_123",
    status: "active",
    customerId: "cus_abc",
    currentPeriodEnd: "2026-08-21T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    customer: { externalId: "user-1" },
    ...overrides,
  };
}

describe("buildSubscriptionRpcArgs", () => {
  it("active 구독을 pro RPC 인자로 매핑한다", () => {
    const args = buildSubscriptionRpcArgs(subscription(), "subscription.active", {
      webhookSecret: "whsec",
    });

    expect(args).toEqual({
      p_webhook_secret: "whsec",
      p_user_id: "user-1",
      p_polar_customer_id: "cus_abc",
      p_polar_subscription_id: "sub_123",
      p_plan: "pro",
      p_status: "active",
      p_current_period_end: "2026-08-21T00:00:00.000Z",
      p_cancel_at_period_end: false,
      p_event_type: "subscription.active",
      p_meta: { polar_status: "active" },
    });
  });

  it("forceRevoked면 polar 상태와 무관하게 free·revoked로 강등한다", () => {
    const args = buildSubscriptionRpcArgs(
      subscription({ status: "active" }),
      "subscription.revoked",
      { webhookSecret: "whsec", forceRevoked: true },
    );

    expect(args?.p_plan).toBe("free");
    expect(args?.p_status).toBe("revoked");
  });

  it("취소 예정 플래그를 보존한다", () => {
    const args = buildSubscriptionRpcArgs(
      subscription({ cancelAtPeriodEnd: true }),
      "subscription.canceled",
      { webhookSecret: "whsec" },
    );

    expect(args?.p_cancel_at_period_end).toBe(true);
    // 취소 예정이어도 status가 active면 pro 유지(유예).
    expect(args?.p_plan).toBe("pro");
  });

  it("current_period_end가 없으면 null", () => {
    const args = buildSubscriptionRpcArgs(
      subscription({ currentPeriodEnd: null }),
      "subscription.updated",
      { webhookSecret: "whsec" },
    );

    expect(args?.p_current_period_end).toBeNull();
  });

  it("customer.externalId가 없으면 소유자를 특정할 수 없어 null을 반환한다", () => {
    const args = buildSubscriptionRpcArgs(
      subscription({ customer: { externalId: null } }),
      "subscription.active",
      { webhookSecret: "whsec" },
    );

    expect(args).toBeNull();
  });

  it("Date 객체 current_period_end도 ISO 문자열로 정규화한다", () => {
    const args = buildSubscriptionRpcArgs(
      subscription({ currentPeriodEnd: new Date("2026-09-01T12:00:00.000Z") }),
      "subscription.active",
      { webhookSecret: "whsec" },
    );

    expect(args?.p_current_period_end).toBe("2026-09-01T12:00:00.000Z");
  });
});

import { mapPolarStatusToPlan } from "@/lib/plan";

// Polar webhook 구독 페이로드에서 우리가 쓰는 필드만 추린 최소 형태.
export type PolarSubscriptionLike = {
  id: string;
  status: string;
  customerId: string;
  currentPeriodEnd?: Date | string | null;
  cancelAtPeriodEnd?: boolean | null;
  customer?: { externalId?: string | null } | null;
};

export type SubscriptionRpcArgs = {
  p_webhook_secret: string;
  p_user_id: string;
  p_polar_customer_id: string;
  p_polar_subscription_id: string;
  p_plan: string;
  p_status: string;
  p_current_period_end: string | null;
  p_cancel_at_period_end: boolean;
  p_event_type: string;
  p_meta: Record<string, unknown>;
};

/**
 * Polar 구독 페이로드 → upsert_subscription_from_polar RPC 인자(순수 함수).
 *  - customer.externalId(체크아웃에서 심은 user.id)가 없으면 소유자 매핑 불가 → null.
 *  - forceRevoked면 상태와 무관하게 free·revoked(즉시 강등, revoked 이벤트용).
 *  - current_period_end는 항상 ISO 문자열/null로 정규화.
 */
export function buildSubscriptionRpcArgs(
  subscription: PolarSubscriptionLike,
  eventType: string,
  options: { webhookSecret: string; forceRevoked?: boolean },
): SubscriptionRpcArgs | null {
  const externalId = subscription.customer?.externalId;
  if (!externalId) return null;

  const mapped = options.forceRevoked
    ? { plan: "free", status: "revoked" }
    : mapPolarStatusToPlan(subscription.status);

  const periodEnd = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toISOString()
    : null;

  return {
    p_webhook_secret: options.webhookSecret,
    p_user_id: externalId,
    p_polar_customer_id: subscription.customerId,
    p_polar_subscription_id: subscription.id,
    p_plan: mapped.plan,
    p_status: mapped.status,
    p_current_period_end: periodEnd,
    p_cancel_at_period_end: subscription.cancelAtPeriodEnd ?? false,
    p_event_type: eventType,
    p_meta: { polar_status: subscription.status },
  };
}

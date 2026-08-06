/**
 * Polar가 실제로 보내는 subscription webhook 페이로드(snake_case).
 * 손으로 줄인 요약본이 아니라 `@polar-sh/sdk`의 zod 스키마를 통과하는 전체 형태여야 한다 —
 * 스키마를 통과하지 못하면 라우트가 SDK 검증 단계에서 던지므로, 이 픽스처 자체가
 * "우리가 가정하는 Polar 페이로드 모양"의 회귀 테스트다.
 */
const ORGANIZATION_ID = "1a2b3c4d-5e6f-4708-9910-2b3c4d5e6f70";
const PRODUCT_ID = "3b0c1d2e-4f50-4617-8829-9a0b1c2d3e4f";
const PRICE_ID = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";
const CUSTOMER_ID = "c0ffee00-1111-4222-8333-444455556666";

export const POLAR_SUBSCRIPTION_ID = "d1e2f3a4-b5c6-4718-8920-1a2b3c4d5e6f";
export const POLAR_CUSTOMER_ID = CUSTOMER_ID;

const price = {
  id: PRICE_ID,
  created_at: "2026-01-01T00:00:00Z",
  modified_at: null,
  source: "catalog",
  amount_type: "fixed",
  price_currency: "usd",
  tax_behavior: null,
  is_archived: false,
  product_id: PRODUCT_ID,
  price_amount: 900,
};

const product = {
  id: PRODUCT_ID,
  created_at: "2026-01-01T00:00:00Z",
  modified_at: null,
  trial_interval: null,
  trial_interval_count: null,
  name: "매듭 Pro",
  description: null,
  visibility: "public",
  recurring_interval: "month",
  recurring_interval_count: 1,
  is_recurring: true,
  is_archived: false,
  organization_id: ORGANIZATION_ID,
  metadata: {},
  prices: [price],
  benefits: [],
  medias: [],
  attached_custom_fields: [],
};

/**
 * @param externalId 체크아웃에서 심은 우리 `auth.users.id`. null이면 소유자 매핑이 불가능한 경우.
 */
export function polarSubscriptionFixture(
  externalId: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: POLAR_SUBSCRIPTION_ID,
    created_at: "2026-08-01T00:00:00Z",
    modified_at: null,
    amount: 900,
    currency: "usd",
    recurring_interval: "month",
    recurring_interval_count: 1,
    status: "active",
    current_period_start: "2026-08-01T00:00:00Z",
    current_period_end: "2026-09-01T00:00:00Z",
    trial_start: null,
    trial_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    started_at: "2026-08-01T00:00:00Z",
    ends_at: null,
    ended_at: null,
    customer_id: CUSTOMER_ID,
    product_id: PRODUCT_ID,
    discount_id: null,
    checkout_id: null,
    customer_cancellation_reason: null,
    customer_cancellation_comment: null,
    metadata: {},
    custom_field_data: {},
    customer: {
      id: CUSTOMER_ID,
      created_at: "2026-07-01T00:00:00Z",
      modified_at: null,
      metadata: {},
      external_id: externalId,
      type: "individual",
      email: "freelancer@example.test",
      email_verified: true,
      name: "김프리",
      billing_address: null,
      tax_id: null,
      organization_id: ORGANIZATION_ID,
      deleted_at: null,
      avatar_url: "https://example.test/avatar.png",
    },
    product,
    discount: null,
    prices: [price],
    meters: [],
    pending_update: null,
    ...overrides,
  };
}

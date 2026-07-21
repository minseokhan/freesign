import { Webhooks } from "@polar-sh/nextjs";

import { applySubscriptionEvent } from "@/lib/billing-webhook";

export const runtime = "nodejs";

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET ?? "",
  onSubscriptionActive: (payload) =>
    applySubscriptionEvent(payload.data, "subscription.active"),
  onSubscriptionUpdated: (payload) =>
    applySubscriptionEvent(payload.data, "subscription.updated"),
  onSubscriptionCanceled: (payload) =>
    applySubscriptionEvent(payload.data, "subscription.canceled"),
  onSubscriptionRevoked: (payload) =>
    applySubscriptionEvent(payload.data, "subscription.revoked", true),
});

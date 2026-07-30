import {
  buildSubscriptionRpcArgs,
  type PolarSubscriptionLike,
} from "@/lib/billing";
import { getPolarEnv } from "@/lib/env";
import { createAnonClient } from "@/lib/supabase/anon";
import type { Database } from "@/types/database";

type UpsertArgs =
  Database["public"]["Functions"]["upsert_subscription_from_polar"]["Args"];

/**
 * 구독 이벤트 → 구독 행 upsert. 세션이 없는 webhook이므로 anon 클라이언트로만 호출하고,
 * 권한은 DEFINER RPC 내부의 webhook 시크릿 게이트가 담당한다(service_role 요청경로 금지).
 * RPC 실패는 throw 한다 — 200(수신 성공)을 돌려주면 Polar가 재전송하지 않아
 * subscription.active/revoked 이벤트가 영구 유실되고(결제한 사용자가 Free로 남거나
 * 해지한 사용자가 Pro를 유지) 보정 경로가 없다(대시보드 #43).
 * 핸들러가 reject 하면 라우트가 5xx를 내고 Polar가 재시도한다.
 * upsert RPC는 멱등이라 재시도가 안전하다.
 */
export async function applySubscriptionEvent(
  subscription: PolarSubscriptionLike,
  eventType: string,
  forceRevoked = false,
): Promise<void> {
  const env = getPolarEnv();
  const args = buildSubscriptionRpcArgs(subscription, eventType, {
    webhookSecret: env.POLAR_WEBHOOK_SECRET,
    forceRevoked,
  });

  if (!args) {
    console.error("[billing/webhook] missing customer.externalId; skipping", {
      eventType,
      subscriptionId: subscription.id,
    });
    return;
  }

  const supabase = createAnonClient();
  // current_period_end는 SQL상 nullable이지만 타입 생성기가 non-null string으로 낸다 —
  // null(만료 없음)을 넘기기 위해 생성 타입으로 캐스팅한다.
  const { error } = await supabase.rpc(
    "upsert_subscription_from_polar",
    args as unknown as UpsertArgs,
  );

  if (error) {
    console.error("[billing/webhook] rpc error:", error.message);
    throw new Error(`upsert_subscription_from_polar failed: ${error.message}`);
  }
}

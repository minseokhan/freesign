import { requireUser } from "@/lib/auth";
import {
  CREATE_FREE_LIMIT,
  IMPORT_FREE_LIMIT,
  SIGN_FREE_LIMIT,
} from "@/lib/plan-features";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type Plan = "free" | "pro";

export type SubscriptionRow = Pick<
  Database["public"]["Tables"]["subscriptions"]["Row"],
  "plan" | "status" | "current_period_end" | "cancel_at_period_end"
>;

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// ── 무료 티어 상한 ──
// 정의는 서버 의존이 없는 plan-features.ts에 두고(공개 랜딩에서도 읽는다) 여기서 재노출한다.
export { IMPORT_FREE_LIMIT, CREATE_FREE_LIMIT, SIGN_FREE_LIMIT };

// usage_counters 버킷. 불러오기 파싱은 저장 없는 호출도 토큰 비용이 나가므로
// 저장 여부와 무관하게 "호출 자체"를 누적 카운트한다.
export const IMPORT_PARSE_BUCKET = "ai_import_parse";

// ── 업셀 문구 ──
export const IMPORT_UPSELL = `무료 플랜은 계약 불러오기(AI 파싱)를 누적 ${IMPORT_FREE_LIMIT}회까지 쓸 수 있어요. 더 불러오려면 Pro로 업그레이드해 주세요.`;
export const CREATE_UPSELL =
  "무료 플랜은 새 계약을 1건까지 만들 수 있어요. 더 만들고 서명받으려면 Pro로 업그레이드해 주세요.";
export const SIGN_UPSELL =
  "무료 플랜은 새 계약 1건까지 서명 요청을 보낼 수 있어요. 계속하려면 Pro로 업그레이드해 주세요.";
export const PRO_ONLY_UPSELL =
  "이 기능은 Pro 전용이에요. 업그레이드하면 바로 사용할 수 있어요.";

export type GateReason =
  | "import_limit"
  | "create_limit"
  | "sign_limit"
  | "pro_only";

export type GateResult =
  | { ok: true; plan: Plan }
  | { ok: false; plan: Plan; reason: GateReason; message: string };

/**
 * 구독 행 + 현재시각 → 유효 플랜(순수 함수).
 *  - 행 없음 / plan=free / status=revoked → free
 *  - 기간(current_period_end)이 지났으면 free (만료 안전망)
 *  - 취소 예정(cancel_at_period_end)이라도 기간이 남았으면 pro 유지(유예)
 */
export function derivePlan(
  subscription: SubscriptionRow | null,
  now: Date,
): Plan {
  if (!subscription) return "free";
  if (subscription.status === "revoked") return "free";
  if (subscription.plan !== "pro") return "free";

  if (subscription.current_period_end) {
    const end = new Date(subscription.current_period_end).getTime();
    if (Number.isFinite(end) && end <= now.getTime()) {
      return "free";
    }
  }

  return "pro";
}

/**
 * Polar 구독 status → 내부 {plan, status}(순수 함수).
 * active/trialing/past_due는 pro(past_due는 유예 — 이후 revoked/unpaid 이벤트로 강등).
 * canceled/unpaid/미지의 상태는 안전 기본값 free.
 */
export function mapPolarStatusToPlan(polarStatus: string): {
  plan: Plan;
  status: string;
} {
  switch (polarStatus) {
    case "active":
    case "trialing":
    case "past_due":
      return { plan: "pro", status: polarStatus };
    default:
      return { plan: "free", status: polarStatus };
  }
}

async function fetchSubscription(
  supabase: ServerClient,
  userId: string,
): Promise<SubscriptionRow | null> {
  const { data } = await supabase
    .from("subscriptions")
    .select("plan,status,current_period_end,cancel_at_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  return data ?? null;
}

async function resolvePlan(
  supabase: ServerClient,
  userId: string,
): Promise<Plan> {
  return derivePlan(await fetchSubscription(supabase, userId), new Date());
}

/** 현재 사용자 유효 플랜(자체 인증·조회). RSC·페이지 렌더용. */
export async function getUserPlan(): Promise<Plan> {
  const user = await requireUser();
  const supabase = await createClient();
  return resolvePlan(supabase, user.id);
}

/**
 * 불러오기 파싱 누적 상한 소비. pro는 스킵(무제한).
 * free는 consume_lifetime_quota로 누적 1 증가·상한 판정.
 * 인프라 오류 시 fail-open(주 흐름 우선) — consume_rate_limit과 동일 정책.
 */
export async function consumeImportQuota(): Promise<GateResult> {
  const user = await requireUser();
  const supabase = await createClient();
  const plan = await resolvePlan(supabase, user.id);

  if (plan === "pro") return { ok: true, plan };

  const { data, error } = await supabase.rpc("consume_lifetime_quota", {
    p_bucket: IMPORT_PARSE_BUCKET,
    p_max: IMPORT_FREE_LIMIT,
  });

  if (error) {
    console.error("[plan] consume_lifetime_quota error:", error.message);
    return { ok: true, plan }; // fail-open
  }

  const res = (data ?? {}) as { allowed?: boolean };
  if (res.allowed) return { ok: true, plan };

  return { ok: false, plan, reason: "import_limit", message: IMPORT_UPSELL };
}

/**
 * 새 계약 생성 게이트. pro는 무제한.
 * free는 "생성한(=불러오기 아닌) 계약" 수가 상한 미만일 때만 허용.
 * 불러온 계약은 source_pdf_url이 있으므로 제외 → 실데이터 기반이라
 * 다운그레이드(pro때 만든 계약이 그대로 카운트) 시에도 정책과 자동 일치.
 */
export async function canCreateContract(
  supabase: ServerClient,
  userId: string,
): Promise<GateResult> {
  const plan = await resolvePlan(supabase, userId);
  if (plan === "pro") return { ok: true, plan };

  const { count } = await supabase
    .from("contracts")
    .select("id", { count: "exact", head: true })
    .is("source_pdf_url", null)
    .is("deleted_at", null);

  if ((count ?? 0) < CREATE_FREE_LIMIT) return { ok: true, plan };

  return { ok: false, plan, reason: "create_limit", message: CREATE_UPSELL };
}

/**
 * 쌍방 서명 요청 발송 게이트. pro는 무제한.
 * free는 "생성한 계약 중 서명 진행(draft 이후)한 건" 수가 상한 미만일 때만 허용.
 */
export async function canSendSignature(
  supabase: ServerClient,
  userId: string,
): Promise<GateResult> {
  const plan = await resolvePlan(supabase, userId);
  if (plan === "pro") return { ok: true, plan };

  const { count } = await supabase
    .from("contracts")
    .select("id", { count: "exact", head: true })
    .is("source_pdf_url", null)
    .is("deleted_at", null)
    .neq("status", "draft");

  if ((count ?? 0) < SIGN_FREE_LIMIT) return { ok: true, plan };

  return { ok: false, plan, reason: "sign_limit", message: SIGN_UPSELL };
}

/** Pro 전용 기능 게이트(Excel export·고급 대시보드). */
export async function assertProFeature(): Promise<GateResult> {
  const plan = await getUserPlan();
  if (plan === "pro") return { ok: true, plan };

  return { ok: false, plan, reason: "pro_only", message: PRO_ONLY_UPSELL };
}

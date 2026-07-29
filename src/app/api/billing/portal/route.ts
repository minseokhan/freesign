import { CustomerPortal } from "@polar-sh/nextjs";
import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getPolarEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 구독 관리 포털 진입. 구독 행의 polar_customer_id로 고객을 특정한다.
// Polar 호출이 실패하면(고객 없음·액세스 토큰 스코프 부족 등) 빈 화면 대신
// 요금제 페이지로 사유와 함께 돌려보낸다.
export async function GET(req: NextRequest) {
  const env = getPolarEnv();
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("subscriptions")
    .select("polar_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const customerId = data?.polar_customer_id;

  if (!customerId) {
    return redirectToBilling(req, "no_customer");
  }

  const handler = CustomerPortal({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER,
    returnUrl: `${req.nextUrl.origin}/billing`,
    getCustomerId: async () => customerId,
  });

  try {
    return await handler(req);
  } catch (error) {
    console.error("[billing] customer portal failed:", error);
    return redirectToBilling(req, "portal_failed");
  }
}

function redirectToBilling(req: NextRequest, reason: string) {
  const url = new URL("/billing", req.nextUrl.origin);
  url.searchParams.set("portal", reason);

  return NextResponse.redirect(url);
}

import { Checkout } from "@polar-sh/nextjs";
import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getPolarEnv, isPolarConfigured } from "@/lib/env";
import { getSiteUrl } from "@/lib/seo";

export const runtime = "nodejs";

// Pro 구독 체크아웃 진입. 상품·고객 식별을 서버에서 주입해 클라이언트는 링크만 건다.
// customerExternalId = user.id → webhook에서 subscription.customer.externalId로 되받아 소유자 매핑.
export async function GET(req: NextRequest) {
  // 결제 미구성 배포에서는 getPolarEnv()가 던져 500이 된다. 이 진입점은 대시보드 전면에
  // 노출돼 있으므로 오류 대신 요금제 페이지의 안내로 되돌린다.
  if (!isPolarConfigured()) {
    const url = new URL("/billing", req.nextUrl.origin);
    url.searchParams.set("portal", "not_configured");

    return NextResponse.redirect(url);
  }

  const user = await requireUser();
  const env = getPolarEnv();

  // 쿼리스트링은 서버가 처음부터 다시 만든다. 예전에는 요청 URL을 그대로 쓰고 3개만
  // 덮어써서, discountId·metadata 같은 나머지 파라미터가 클라이언트가 넣은 대로 결제 API에
  // 도달했다. 이 진입점은 링크로 여는 GET이라 누구나 쿼리스트링을 붙일 수 있다.
  const url = new URL(req.nextUrl.pathname, req.nextUrl.origin);
  url.searchParams.set("products", env.POLAR_PRODUCT_ID);
  url.searchParams.set("customerExternalId", user.id);
  if (user.email) {
    url.searchParams.set("customerEmail", user.email);
  }

  const handler = Checkout({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER,
    successUrl: `${getSiteUrl()}/settings?checkout=success`,
  });

  return handler(new NextRequest(url, { headers: req.headers }));
}

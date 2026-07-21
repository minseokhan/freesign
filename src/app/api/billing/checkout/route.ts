import { Checkout } from "@polar-sh/nextjs";
import { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { getPolarEnv } from "@/lib/env";
import { getSiteUrl } from "@/lib/seo";

export const runtime = "nodejs";

// Pro 구독 체크아웃 진입. 상품·고객 식별을 서버에서 주입해 클라이언트는 링크만 건다.
// customerExternalId = user.id → webhook에서 subscription.customer.externalId로 되받아 소유자 매핑.
export async function GET(req: NextRequest) {
  const user = await requireUser();
  const env = getPolarEnv();

  const url = new URL(req.url);
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

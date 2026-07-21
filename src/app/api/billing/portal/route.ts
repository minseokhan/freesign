import { CustomerPortal } from "@polar-sh/nextjs";
import { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { getPolarEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 구독 관리 포털 진입. 구독 행의 polar_customer_id로 고객을 특정한다.
export async function GET(req: NextRequest) {
  const env = getPolarEnv();

  const handler = CustomerPortal({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER,
    returnUrl: `${req.nextUrl.origin}/settings`,
    getCustomerId: async () => {
      const user = await requireUser();
      const supabase = await createClient();
      const { data } = await supabase
        .from("subscriptions")
        .select("polar_customer_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!data?.polar_customer_id) {
        throw new Error("no polar customer for user");
      }

      return data.polar_customer_id;
    },
  });

  return handler(req);
}

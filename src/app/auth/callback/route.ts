import { NextResponse } from "next/server";

import { getPostHogClient } from "@/lib/posthog-server";
import { getSafeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

function redirectToLogin(requestUrl: URL) {
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("error", "auth");

  return NextResponse.redirect(loginUrl);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return redirectToLogin(requestUrl);
  }

  try {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return redirectToLogin(requestUrl);
    }

    if (data.user) {
      const posthog = getPostHogClient();
      posthog.identify({ distinctId: data.user.id });
      posthog.capture({ distinctId: data.user.id, event: "user_signed_in" });
      await posthog.flush();
    }
  } catch {
    return redirectToLogin(requestUrl);
  }

  const redirectPath = getSafeRedirectPath(
    requestUrl.searchParams.get("next"),
    requestUrl.origin,
  );

  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
}

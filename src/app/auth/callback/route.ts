import { NextResponse } from "next/server";

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
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return redirectToLogin(requestUrl);
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

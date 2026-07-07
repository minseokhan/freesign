import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

function isSafeInternalPath(path: string | null): path is string {
  return Boolean(path?.startsWith("/") && !path.startsWith("//"));
}

function getRedirectPath(path: string | null) {
  if (isSafeInternalPath(path)) {
    return path;
  }

  return "/dashboard";
}

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

  const redirectPath = getRedirectPath(requestUrl.searchParams.get("next"));

  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
}

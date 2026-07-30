import { NextResponse } from "next/server";

import { captureServerException, getPostHogClient } from "@/lib/posthog-server";
import { getSafeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

// 인증 실패는 성공(user_signed_in)과 달리 어디에도 기록되지 않아 급증(코드 재사용·콜백
// 파라미터 조작·공급자 장애)을 탐지할 수 없었다(대시보드 #39). code·토큰 값 자체는 남기지 않는다.
function redirectToLogin(requestUrl: URL, reason: string) {
  console.warn("[auth] callback 실패:", reason);

  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("error", "auth");

  return NextResponse.redirect(loginUrl);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return redirectToLogin(requestUrl, "missing code");
  }

  try {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      await captureServerException(error, undefined, { route: "auth/callback" });
      return redirectToLogin(requestUrl, error.message);
    }

    if (data.user) {
      const posthog = getPostHogClient();
      posthog.identify({ distinctId: data.user.id });
      posthog.capture({ distinctId: data.user.id, event: "user_signed_in" });
      await posthog.flush();
    }
  } catch (error) {
    await captureServerException(error, undefined, { route: "auth/callback" });
    return redirectToLogin(
      requestUrl,
      error instanceof Error ? error.message : "exception",
    );
  }

  const redirectPath = getSafeRedirectPath(
    requestUrl.searchParams.get("next"),
    requestUrl.origin,
  );

  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
}

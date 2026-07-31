import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { buildContentSecurityPolicy, generateCspNonce } from "@/lib/csp";
import { getPublicEnv } from "@/lib/env";
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import type { Database } from "@/types/database";

export async function middleware(request: NextRequest) {
  const env = getPublicEnv();

  // Next는 "요청" 헤더의 CSP에서 nonce를 읽어 자기 인라인 스크립트에 붙인다.
  // 아래 supabase 쿠키 갱신이 request.cookies를 건드리므로, 응답을 새로 만들 때마다
  // 그 시점의 request.headers를 다시 읽어야 갱신된 쿠키가 유실되지 않는다.
  const nonce = generateCspNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set("content-security-policy", csp);
    return headers;
  };

  let response = NextResponse.next({ request: { headers: requestHeaders() } });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      // lib/supabase/server.ts와 반드시 같은 값이어야 갱신·삭제가 정상 동작한다.
      cookieOptions: SUPABASE_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request: { headers: requestHeaders() },
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  await supabase.auth.getUser();

  response.headers.set("content-security-policy", csp);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

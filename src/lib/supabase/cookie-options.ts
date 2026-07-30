import type { CookieOptions } from "@supabase/ssr";

/**
 * sb-* 세션 쿠키 하드닝(OWASP 스캔 A07 · 대시보드 #28).
 * @supabase/ssr 기본값은 httpOnly:false에 secure 키가 아예 없어서, XSS 한 번으로
 * access·refresh 토큰이 document.cookie로 통째로 새어 나간다.
 *
 * 브라우저 Supabase 클라이언트(lib/supabase/client.ts)는 앱 코드에서 쓰지 않으므로
 * httpOnly로 깨지는 경로가 없다. server.ts와 middleware.ts가 **같은 값**을 써야
 * 갱신·삭제가 정상 동작한다(불일치 시 중복 쿠키).
 */
export const SUPABASE_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};

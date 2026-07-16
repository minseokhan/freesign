// 공개 서명 표면 전용 anon 클라이언트 — 쿠키·세션 없이 anon 키로만 동작한다.
// anon에는 테이블 RLS 정책이 없으므로(0018) anon-grant DEFINER RPC만 호출 가능하다.
// service_role 키는 요청 경로에서 절대 금지(CLAUDE.md CRITICAL).
import { createServerClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

export function createAnonClient() {
  const env = getPublicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // 공개 표면은 세션을 만들지 않는다.
        },
      },
    },
  );
}

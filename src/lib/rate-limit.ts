import { createClient } from "@/lib/supabase/server";

export type RateLimitConfig = {
  bucket: string;
  max: number;
  windowSeconds: number;
};

// 비싼 AI 엔드포인트별 사용자 단위 상한. 실제 사용(하루 몇 건)엔 걸리지 않되
// 반복 호출(비용/자원 남용)은 빠르게 차단하는 값.
export const RATE_LIMITS = {
  aiPdfParse: { bucket: "ai_pdf_parse", max: 10, windowSeconds: 60 },
  aiDraft: { bucket: "ai_draft", max: 20, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfter: number };

/**
 * consume_rate_limit RPC의 응답/에러를 결과로 정규화한다.
 * 인프라 오류(error 있음) 시엔 주 흐름을 막지 않도록 fail-open(통과)하되 로깅한다 —
 * 레이트리밋은 비용/남용 방어이지 인가 게이트가 아니므로, 가용성을 우선한다.
 */
export function parseRateLimitResponse(
  data: unknown,
  error: { message?: string } | null,
  windowSeconds: number,
): RateLimitResult {
  if (error) {
    console.error("[rate-limit] rpc error:", error.message);
    return { allowed: true };
  }

  const res = (data ?? {}) as { allowed?: boolean; retry_after?: number };

  if (res.allowed) {
    return { allowed: true };
  }

  return { allowed: false, retryAfter: res.retry_after ?? windowSeconds };
}

/**
 * 현재 인증 사용자에 대해 해당 버킷의 슬라이딩 윈도우 상한을 소비한다.
 * user_id는 RPC 내부에서 auth.uid()로 결정된다(클라이언트 입력 아님).
 * 레이트리밋 저장소 자체가 불가용해도 주 요청을 막지 않도록 예외는 fail-open 처리한다.
 */
export async function checkRateLimit(
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("consume_rate_limit", {
      p_bucket: config.bucket,
      p_max: config.max,
      p_window_seconds: config.windowSeconds,
    });

    return parseRateLimitResponse(data, error, config.windowSeconds);
  } catch (err) {
    console.error(
      "[rate-limit] unavailable:",
      err instanceof Error ? err.message : err,
    );
    return { allowed: true };
  }
}

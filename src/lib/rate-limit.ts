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
  aiContractInsight: { bucket: "ai_contract_insight", max: 10, windowSeconds: 60 },
  // 서명 요청 발송·재발송(이메일 발송 동반) 공용 버킷 — 이메일 스팸/남용 방지.
  signatureSend: { bucket: "signature_send", max: 5, windowSeconds: 60 },
  // 독촉 승인·발송도 제3자(클라이언트) 메일함으로 나가는 경로다(대시보드 #26).
  dunningSend: { bucket: "dunning_send", max: 5, windowSeconds: 60 },
  // 인보이스 발행·재발송(청구 안내 메일 동반, 0046).
  invoiceSend: { bucket: "invoice_send", max: 5, windowSeconds: 60 },
  // 계정 데이터 전체 덤프는 테이블 전수 조회라 비싸다. 열람권 행사에는 넉넉하되
  // 반복 호출로 DB를 긁는 것은 막는 값.
  accountExport: { bucket: "account_export", max: 3, windowSeconds: 3600 },
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
  bucket?: string,
): RateLimitResult {
  if (error) {
    // fail-open은 의도된 트레이드오프지만 무음이면 안 된다 — 저장소 장애 동안 상한이
    // 통째로 사라지므로 관측 가능해야 한다(대시보드 #24·#47).
    console.error("[rate-limit] rpc error (fail-open):", bucket, error.message);
    return { allowed: true };
  }

  const res = (data ?? {}) as { allowed?: boolean; retry_after?: number };

  if (res.allowed) {
    return { allowed: true };
  }

  // 차단 발동(=남용 방어선이 실제로 동작한 순간)도 기록한다(대시보드 #40).
  console.warn("[rate-limit] blocked:", bucket);

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

    return parseRateLimitResponse(data, error, config.windowSeconds, config.bucket);
  } catch (err) {
    console.error(
      "[rate-limit] unavailable (fail-open):",
      config.bucket,
      err instanceof Error ? err.message : err,
    );
    return { allowed: true };
  }
}

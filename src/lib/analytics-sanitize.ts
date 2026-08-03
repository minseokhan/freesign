import type { CaptureResult } from "posthog-js";

// 공개 서명 링크(/sign/{raw token})는 14일 유효한 bearer 자격증명이다. 계약 열람·서명 완결·
// 증명서 교부를 전부 수행할 수 있으므로 분석 이벤트로 서드파티에 나가면 안 된다.
// posthog-js는 $current_url·$pathname·$referrer 등 여러 속성에 URL을 싣고 그 목록이 버전마다
// 달라지므로, 이름을 열거하지 않고 문자열 값 전부에서 토큰 구간만 치환한다.
export const REDACTED_SIGN_PATH = "/sign/[token]";

const SIGN_TOKEN_PATTERN = /\/sign\/[^/?#\s]+/g;

export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    sanitized[key] =
      typeof value === "string" ? value.replace(SIGN_TOKEN_PATTERN, REDACTED_SIGN_PATH) : value;
  }

  return sanitized;
}

/**
 * posthog-js `before_send` 훅. deprecated된 `sanitize_properties`를 대체한다.
 * 이벤트 properties 외에 person 속성($set·$set_once — `$initial_current_url`이 여기 실린다)까지
 * 훑는다. 앞선 훅이 드롭한 이벤트(null)는 그대로 흘려보낸다.
 */
export function sanitizeAnalyticsEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;

  const sanitized: CaptureResult = {
    ...event,
    properties: sanitizeAnalyticsProperties(event.properties),
  };

  if (event.$set) sanitized.$set = sanitizeAnalyticsProperties(event.$set);
  if (event.$set_once) sanitized.$set_once = sanitizeAnalyticsProperties(event.$set_once);

  return sanitized;
}

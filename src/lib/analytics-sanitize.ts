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

import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

export function getPostHogClient(): PostHog {
  if (!posthogClient) {
    posthogClient = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  }

  return posthogClient;
}

/**
 * 요청 쿠키 헤더에서 PostHog distinct_id를 읽는다.
 *
 * posthog-js가 심는 `ph_<token>_posthog` 쿠키(URL 인코딩된 JSON)를 파싱해
 * 서버에서 캡처한 예외를 동일 사용자에 연결할 때 사용한다.
 */
export function parsePostHogDistinctId(
  cookieHeader: string | undefined,
  token: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const prefix = `ph_${token}_posthog=`;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!cookie) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(
      decodeURIComponent(cookie.slice(prefix.length)),
    );

    if (
      parsed &&
      typeof parsed === "object" &&
      "distinct_id" in parsed &&
      typeof parsed.distinct_id === "string"
    ) {
      return parsed.distinct_id;
    }
  } catch {
    // 쿠키가 깨져 있으면 식별 없이 캡처한다.
  }

  return undefined;
}

/**
 * 서버 사이드 예외를 PostHog 에러 트래킹으로 보낸다.
 *
 * 텔레메트리는 요청 처리를 절대 깨뜨리면 안 되므로 내부 오류는 삼키고,
 * 토큰이 없는 환경(로컬 테스트 등)에서는 no-op으로 동작한다.
 */
export async function captureServerException(
  error: unknown,
  distinctId?: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
    return;
  }

  try {
    const posthog = getPostHogClient();
    const exception =
      error instanceof Error ? error : new Error(String(error));
    posthog.captureException(exception, distinctId, properties);
    await posthog.flush();
  } catch (captureError) {
    console.error("[posthog] 예외 캡처 실패:", captureError);
  }
}

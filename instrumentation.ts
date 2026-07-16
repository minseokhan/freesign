import type { Instrumentation } from "next";

/**
 * Next.js가 서버에서 처리하지 못한 모든 예외(RSC·라우트 핸들러·Server Action)를
 * PostHog 에러 트래킹으로 보낸다. 처리된 오류(dbError·라우트 500 분기)는
 * 각 지점에서 captureServerException으로 별도 캡처한다.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  // posthog-node는 Node 런타임 전용이다(middleware 등 edge 제외).
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { captureServerException, parsePostHogDistinctId } = await import(
    "@/lib/posthog-server"
  );
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const cookieHeader = Array.isArray(request.headers.cookie)
    ? request.headers.cookie.join("; ")
    : request.headers.cookie;
  const distinctId = token
    ? parsePostHogDistinctId(cookieHeader, token)
    : undefined;

  await captureServerException(error, distinctId, {
    path: request.path,
    method: request.method,
    router_kind: context.routerKind,
    route_type: context.routeType,
  });
};

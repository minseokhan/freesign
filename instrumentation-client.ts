import posthog from "posthog-js";

import { sanitizeAnalyticsProperties } from "@/lib/analytics-sanitize";

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: "/ingest",
  ui_host: "https://us.posthog.com",
  defaults: "2026-01-30",
  capture_exceptions: true,
  debug: process.env.NODE_ENV === "development",
  // /sign/{token} 의 원문 서명 토큰이 $current_url 등으로 PostHog에 저장되는 것을 막는다.
  sanitize_properties: sanitizeAnalyticsProperties,
});

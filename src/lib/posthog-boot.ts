import posthog from "posthog-js";

import { sanitizeAnalyticsProperties } from "@/lib/analytics-sanitize";

// PostHog 부트스트랩(설정 요청 /flags·/e/, exception-autocapture·dead-clicks·web-vitals 번들)이
// 초기 로드와 대역폭·메인스레드를 다투지 않도록 유휴 시점으로 미룬다.
// 초기화 전에 부른 identify 등은 조용히 무시되므로 준비 시점을 promise로 노출한다.
let booted: Promise<void> | null = null;

export function bootPostHog(): Promise<void> {
  booted ??= new Promise<void>((resolve) => {
    const boot = () => {
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
        api_host: "/ingest",
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        capture_exceptions: true,
        debug: process.env.NODE_ENV === "development",
        // /sign/{token} 의 원문 서명 토큰이 $current_url 등으로 PostHog에 저장되는 것을 막는다.
        sanitize_properties: sanitizeAnalyticsProperties,
        // 설문을 쓰지 않는데도 surveys.js(~98KB)가 매 로드마다 받아진다. 설문을 도입하면 되돌릴 것.
        disable_surveys: true,
      });
      resolve();
    };

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(boot, { timeout: 5000 });
    } else {
      window.setTimeout(boot, 2000);
    }
  });

  return booted;
}

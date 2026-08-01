import posthog from "posthog-js";

import { sanitizeAnalyticsProperties } from "@/lib/analytics-sanitize";

// PostHog 부트스트랩(설정 요청 /flags·/e/, exception-autocapture·dead-clicks·web-vitals 번들)이
// 초기 로드와 대역폭·메인스레드를 다투지 않도록 유휴 시점으로 미룬다.
// 초기화 전에 부른 identify 등은 조용히 무시되므로 준비 시점을 promise로 노출한다.
let booted: Promise<void> | null = null;
let initialized = false;
let settle: (() => void) | null = null;

function initNow(): void {
  if (initialized) return;
  initialized = true;

  window.removeEventListener("error", onEarlyError);
  window.removeEventListener("unhandledrejection", onEarlyRejection);

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

  settle?.();
}

// 부트 전에 터진 예외는 PostHog가 아직 듣지 않아 통째로 유실된다 — 초기 렌더가 죽는,
// 가장 알고 싶은 예외가 정확히 이 창에 들어온다. 첫 예외를 보면 즉시 초기화하고 그것만
// 직접 올린다(이후 예외는 PostHog 자체 핸들러가 받는다).
function captureEarly(error: unknown): void {
  initNow();
  posthog.captureException(error);
}

function onEarlyError(event: ErrorEvent): void {
  captureEarly(event.error ?? new Error(event.message));
}

function onEarlyRejection(event: PromiseRejectionEvent): void {
  captureEarly(event.reason);
}

export function bootPostHog(): Promise<void> {
  booted ??= new Promise<void>((resolve) => {
    settle = resolve;

    window.addEventListener("error", onEarlyError);
    window.addEventListener("unhandledrejection", onEarlyRejection);

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(initNow, { timeout: 5000 });
    } else {
      window.setTimeout(initNow, 2000);
    }
  });

  return booted;
}

/** 유휴 대기를 건너뛰고 지금 초기화한다. 화면이 이미 죽은 뒤라 성능보다 보고가 급할 때 쓴다. */
export function bootPostHogNow(): Promise<void> {
  const ready = bootPostHog();
  initNow();

  return ready;
}

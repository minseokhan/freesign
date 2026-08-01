"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

import { Button } from "@/components/ui/button";
import { bootPostHogNow } from "@/lib/posthog-boot";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 에러 바운더리가 잡은 렌더링 예외는 window.onerror에 도달하지 않으므로 명시 캡처한다.
    // 부트가 유휴 시점까지 미뤄져 있으면 초기 렌더 크래시가 유실되므로 먼저 초기화한다.
    void bootPostHogNow().then(() => posthog.captureException(error));
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
          <section className="flex min-h-80 w-full max-w-md flex-col items-center justify-center gap-4 rounded-[14px] border border-slate-200 bg-white p-6 text-center shadow-[0_1px_2px_rgba(15,23,42,0.06),0_1px_3px_rgba(15,23,42,0.10)]">
            <div
              aria-hidden="true"
              className="text-3xl font-semibold text-red-600"
            >
              !
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                화면을 불러오지 못했어요
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                잠시 후 다시 시도해 주세요.
              </p>
            </div>
            <Button onClick={reset}>다시 시도</Button>
          </section>
        </main>
      </body>
    </html>
  );
}

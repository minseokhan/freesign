"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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

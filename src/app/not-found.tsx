import Link from "next/link";

import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="flex min-h-80 w-full max-w-md flex-col items-center justify-center gap-lg text-center">
        <div aria-hidden="true" className="text-3xl font-semibold text-brand-primary">
          404
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-primary">
            페이지를 찾을 수 없어요
          </h1>
          <p className="mt-sm text-sm leading-relaxed text-text-muted">
            주소가 바뀌었거나 접근할 수 없는 화면입니다.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          대시보드로 이동
        </Link>
      </Card>
    </main>
  );
}

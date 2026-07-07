import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-page md:flex">
      <AppSidebar />
      <div className="min-w-0 flex-1">
        <header className="border-b border-surface-border bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-lg px-lg py-lg">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                FreeSign
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
                정산 워크스페이스
              </h1>
            </div>
            <div
              aria-hidden="true"
              className="hidden min-h-11 min-w-28 rounded-md border border-dashed border-surface-border md:block"
            />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-lg py-2xl">
          {children}
        </main>
      </div>
    </div>
  );
}

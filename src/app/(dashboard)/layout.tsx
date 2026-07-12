import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const metadata = user.user_metadata ?? {};
  const displayName =
    (metadata.full_name as string | undefined)?.trim() ||
    (metadata.name as string | undefined)?.trim() ||
    user.email ||
    "사용자";
  const avatarUrl =
    (metadata.avatar_url as string | undefined) ??
    (metadata.picture as string | undefined) ??
    null;

  return (
    <div className="min-h-screen bg-surface-page md:flex">
      <AppSidebar />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-surface-border bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-lg px-lg py-lg">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                FreeSign
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
                정산 워크스페이스
              </h1>
            </div>
            <UserMenu
              name={displayName}
              email={user.email ?? ""}
              avatarUrl={avatarUrl}
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

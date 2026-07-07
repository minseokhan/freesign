"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/clients", label: "클라이언트" },
  { href: "/contracts", label: "계약" },
  { href: "/invoices", label: "인보이스" },
  { href: "/reports", label: "리포트" },
  { href: "/settings", label: "설정" }
] as const;

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname() ?? "/dashboard";

  return (
    <aside className="w-full border-b border-surface-border bg-white md:min-h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex h-full flex-col gap-xl px-lg py-xl">
        <Link
          href="/dashboard"
          className="text-lg font-semibold tracking-tight text-text-primary"
        >
          FreeSign
        </Link>
        <nav aria-label="대시보드 내비게이션" className="flex flex-col gap-xs">
          {navItems.map((item) => {
            const active = isActivePath(pathname, item.href);

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-md py-sm text-sm font-medium text-text-muted transition-colors",
                  "hover:bg-surface-muted hover:text-text-primary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
                  active && "bg-blue-50 text-blue-600",
                )}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

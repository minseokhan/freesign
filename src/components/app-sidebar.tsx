"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/clients", label: "클라이언트" },
  { href: "/contracts", label: "계약" },
  { href: "/invoices", label: "인보이스" },
  { href: "/invoices/recurring", label: "반복 인보이스", proOnly: true },
  { href: "/reports", label: "리포트" },
  { href: "/settings", label: "설정" }
] as const;

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 활성 메뉴의 href. `/invoices/recurring`은 `/invoices` 접두사와도 일치하므로
 * 일치하는 항목 중 가장 긴 href를 골라야 두 메뉴가 동시에 켜지지 않는다.
 */
function findActiveHref(pathname: string) {
  return navItems.reduce<string | null>((best, item) => {
    if (!isActivePath(pathname, item.href)) {
      return best;
    }

    return best && best.length >= item.href.length ? best : item.href;
  }, null);
}

export function AppSidebar() {
  const pathname = usePathname() ?? "/dashboard";
  const activeHref = findActiveHref(pathname);

  return (
    <aside className="w-full border-b border-surface-border bg-white md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:self-start md:border-b-0 md:border-r">
      <div className="flex h-full flex-col gap-xl overflow-y-auto px-lg py-xl">
        <Link
          href="/dashboard"
          className="inline-flex self-start rounded-sm px-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          <Logo className="h-7" />
        </Link>
        <nav aria-label="대시보드 내비게이션" className="flex flex-col gap-xs">
          {navItems.map((item) => {
            const active = activeHref === item.href;
            // Pro 전용 메뉴는 플랜과 무관하게 뱃지로 표시한다(free는 클릭 시 업그레이드 안내).
            const proOnly = "proOnly" in item && item.proOnly;

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between gap-sm rounded-md px-md py-sm text-sm font-medium text-text-muted transition-colors",
                  "hover:bg-surface-muted hover:text-text-primary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
                  active && "bg-blue-50 text-blue-600",
                )}
                href={item.href}
                key={item.href}
              >
                {item.label}
                {proOnly ? <Badge variant="neutral">Pro</Badge> : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

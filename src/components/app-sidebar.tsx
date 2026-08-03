"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LegalLinks } from "@/components/legal/legal-links";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import type { Plan } from "@/lib/plan";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  proOnly?: boolean;
};

const navItems: readonly NavItem[] = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/clients", label: "클라이언트" },
  { href: "/contracts", label: "계약" },
  { href: "/invoices", label: "인보이스" },
  { href: "/invoices/recurring", label: "반복 인보이스", proOnly: true },
  { href: "/reports", label: "리포트" },
  { href: "/billing", label: "요금제" },
  { href: "/settings", label: "설정" }
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 활성 메뉴의 href. `/invoices/recurring`은 `/invoices` 접두사와도 일치하므로
 * 일치하는 항목 중 가장 긴 href를 골라야 두 메뉴가 동시에 켜지지 않는다.
 */
function findActiveHref(pathname: string, items: readonly NavItem[]) {
  return items.reduce<string | null>((best, item) => {
    if (!isActivePath(pathname, item.href)) {
      return best;
    }

    return best && best.length >= item.href.length ? best : item.href;
  }, null);
}

export function AppSidebar({ plan }: { plan: Plan }) {
  const pathname = usePathname() ?? "/dashboard";
  // Pro 전용 메뉴는 Pro 플랜에서만 노출한다(free는 메뉴 자체가 보이지 않음).
  const items =
    plan === "pro" ? navItems : navItems.filter((item) => !item.proOnly);
  const activeHref = findActiveHref(pathname, items);

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
          {items.map((item) => {
            const active = activeHref === item.href;

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between gap-sm rounded-md px-md py-sm text-sm font-medium text-text-muted transition-colors",
                  "hover:bg-surface-muted hover:text-text-primary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
                  active && "bg-brand-point text-brand-primary",
                )}
                href={item.href}
                key={item.href}
              >
                {item.label}
                {item.proOnly ? (
                  <Badge
                    variant="neutral"
                    className="px-2 py-0 text-[10px] leading-4"
                  >
                    Pro
                  </Badge>
                ) : null}
              </Link>
            );
          })}
        </nav>
        {/* gap은 덮어쓰지 않는다 — cn(twMerge)이 커스텀 여백 토큰을 병합하지 못해
            gap-sm을 넘겨도 base의 gap-lg가 이긴다. 세로 배치만 바꾼다. */}
        <LegalLinks className="mt-auto flex-col" />
      </div>
    </aside>
  );
}

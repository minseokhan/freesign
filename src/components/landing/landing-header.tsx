import Link from "next/link";

import { Logo } from "@/components/logo";

type LandingHeaderProps = {
  isAuthenticated: boolean;
};

export function LandingHeader({ isAuthenticated }: LandingHeaderProps) {
  const cta = isAuthenticated
    ? { href: "/dashboard", label: "대시보드로 이동" }
    : { href: "/login", label: "로그인" };

  return (
    <header className="sticky top-0 z-30 border-b border-surface-border bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-lg py-md">
        <Link
          href="/"
          className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          <Logo className="h-7" />
        </Link>
        <Link
          href={cta.href}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          {cta.label}
        </Link>
      </div>
    </header>
  );
}

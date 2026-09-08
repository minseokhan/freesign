import Link from "next/link";
import type { ReactNode } from "react";

import { LegalLinks } from "@/components/legal/legal-links";
import { Logo } from "@/components/logo";

// 고지 문서 전용 레이아웃 — 로그인 전에도 읽을 수 있어야 하므로 (dashboard)의 인증 셸을
// 쓰지 않고, (public)/sign의 색인 금지 정책도 적용하지 않는다(고지 문서는 색인돼야 한다).
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-page">
      <header className="border-b border-surface-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center px-lg py-lg">
          <Link
            href="/"
            className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
          >
            <Logo className="h-9" />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-lg py-2xl">{children}</main>

      <footer className="border-t border-surface-border">
        <div className="mx-auto max-w-3xl px-lg py-xl">
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}

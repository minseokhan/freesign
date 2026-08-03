import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LegalLinks } from "@/components/legal/legal-links";
import { Logo } from "@/components/logo";

// 공개 서명 페이지 전용 레이아웃 — 대시보드 셸(사이드바·인증 가드) 없이
// 최소한의 브랜드 헤더만 둔다. 토큰 URL 유출 방지를 위해 색인 금지 +
// referrer 미전송(meta). 응답 헤더 Referrer-Policy는 next.config에서 강제한다.
export const metadata: Metadata = {
  title: "계약 서명",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PublicSignLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-page">
      <header className="border-b border-surface-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center px-lg py-lg">
          <Logo className="h-6" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-lg py-2xl">{children}</main>
      {/* 비로그인 서명자의 이메일·접속 기록을 수집하므로 처리방침 고지 경로가 필요하다. */}
      <footer className="border-t border-surface-border">
        <div className="mx-auto w-full max-w-3xl px-lg py-xl">
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}

import Link from "next/link";

import { cn } from "@/lib/utils";

const LEGAL_LINKS = [
  { href: "/legal/privacy", label: "개인정보처리방침" },
  { href: "/legal/terms", label: "이용약관" },
  { href: "/legal/refund", label: "환불 및 청약철회 정책" },
] as const;

/**
 * 고지 문서 링크 묶음. 랜딩 푸터·대시보드 사이드바·공개 서명 페이지·고지 레이아웃이
 * 같은 목록을 쓰도록 한 곳에 둔다. 특히 공개 서명 페이지에는 반드시 있어야 한다 —
 * 비로그인 서명자의 이메일·접속 기록을 수집하므로 처리방침 고지 경로가 필요하다.
 */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav
      aria-label="고지 문서"
      className={cn("flex flex-wrap gap-lg text-xs text-text-muted", className)}
    >
      {LEGAL_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-sm hover:text-text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

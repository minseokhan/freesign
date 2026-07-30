import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

import { getSiteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        {/*
          버전 고정 + SRI(대시보드 #10). `/gh/<user>/<repo>/` 경로는 기본 브랜치의 현재 내용을
          그대로 받아오므로, 저장소나 CDN이 침해되면 대시보드와 공개 서명 페이지에 임의 CSS가
          주입된다(금액·경고 문구를 가리는 UI 리드레스). jsDelivr의 버전 고정 URL은 불변이라
          integrity 검증이 가능하다 — 버전을 올릴 때 해시도 같이 갱신할 것:
            curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A
        */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css"
          integrity="sha384-2nNKoOPayicGa+aRguOQuiZP+RqQ4G3jalfDeOgftkKD7zBM2gJXTwcFqCZltdv0"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen bg-surface-page text-text-body">
        {children}
      </body>
    </html>
  );
}

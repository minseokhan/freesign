import type { NextConfig } from "next";

// 전 경로에 적용할 보안 응답 헤더.
// 재무·전자서명 데이터를 다루므로 최소한의 하드닝을 프레임워크 레벨에서 강제한다.
// CSP는 앱 리소스 로딩을 깨지 않도록 클릭재킹 방어(frame-ancestors)로 한정한다.
// 전면 리소스 CSP(script-src 등)는 nonce 도입이 필요해 후속 과제로 둔다.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 스트리밍 메타데이터 비활성화: 동적 페이지에서도 메타 태그를 항상 <head>에
  // 블로킹으로 내보낸다. 기본값은 JS 실행 봇에게 <body>로 스트리밍하는데,
  // 네이버 Yeti 등 국내 크롤러가 기본 UA 목록에 없어 메타를 놓칠 수 있다.
  // 이 앱의 메타데이터는 정적 상수라 블로킹 비용이 없다.
  htmlLimitedBots: /.*/,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
  outputFileTracingIncludes: {
    "/api/contracts/[id]/pdf": [
      "./public/fonts/Pretendard-Regular.ttf",
      "./node_modules/@react-pdf/**/*",
      "./node_modules/fontkit/**/*",
      "./node_modules/@swc/helpers/**/*",
    ],
    "/api/invoices/[id]/pdf": [
      "./public/fonts/Pretendard-Regular.ttf",
      "./node_modules/@react-pdf/**/*",
      "./node_modules/fontkit/**/*",
      "./node_modules/@swc/helpers/**/*",
    ],
  },
};

export default nextConfig;

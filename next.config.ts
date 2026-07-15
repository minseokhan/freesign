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
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
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

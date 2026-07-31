import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import type { NextConfig } from "next";

// dev 전용: /ingest→PostHog 리라이트 프록시의 ETIMEDOUT 방지 (2026-07 실측).
// 1) IPv6 미작동 네트워크에서 AAAA 주소 우선 접속 시도를 피하도록 IPv4 우선.
// 2) Happy Eyeballs 주소별 시도 타임아웃 기본 250ms가 미국 서버 TCP 연결(~244ms)과
//    경계에 걸려 전 주소 실패(AggregateError) — 여유 있게 늘린다.
// NODE_OPTIONS는 next-server 자식 프로세스에 전달되지 않아 config 로드 시점에 설정한다.
if (process.env.NODE_ENV === "development") {
  setDefaultResultOrder("ipv4first");
  setDefaultAutoSelectFamilyAttemptTimeout(2000);
}

// 전 경로에 적용할 보안 응답 헤더.
// 재무·전자서명 데이터를 다루므로 최소한의 하드닝을 프레임워크 레벨에서 강제한다.
//
// CSP는 여기가 아니라 middleware에 있다(`src/lib/csp.ts`).
// script-src에 요청별 nonce를 넣어야 해서 정적 headers()로는 만들 수 없다.
// middleware matcher가 제외하는 정적 에셋(_next/static·이미지)에는 CSP가 붙지 않는데,
// 스크립트·스타일 파일 응답 자체에 대한 CSP는 실행 제어에 영향이 없다.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 쓰지 않는 브라우저 기능은 명시적으로 끈다(서명 캔버스는 포인터 입력만 쓴다).
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 검증용 빌드가 dev 서버의 산출물을 덮어쓰지 않도록 출력 디렉토리를 분리한다.
  // 기본은 `.next`(dev·Vercel 배포). Stop hook 등 검증 빌드만 NEXT_DIST_DIR로
  // 다른 디렉토리를 지정해, 켜져 있는 dev 서버의 청크가 삭제되는 것을 막는다.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // 스트리밍 메타데이터 비활성화: 동적 페이지에서도 메타 태그를 항상 <head>에
  // 블로킹으로 내보낸다. 기본값은 JS 실행 봇에게 <body>로 스트리밍하는데,
  // 네이버 Yeti 등 국내 크롤러가 기본 UA 목록에 없어 메타를 놓칠 수 있다.
  // 이 앱의 메타데이터는 정적 상수라 블로킹 비용이 없다.
  htmlLimitedBots: /.*/,
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // 공개 서명 표면: 토큰 URL 유출 방지(no-referrer) + 검색 색인 금지.
      // 같은 키는 뒤 규칙이 우선하므로 전역 Referrer-Policy를 덮어쓴다.
      {
        source: "/sign/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/api/sign/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
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
    // step 7 owner용 완결증명서 라우트도 PDF를 렌더한다.
    "/api/contracts/[id]/certificate": [
      "./public/fonts/Pretendard-Regular.ttf",
      "./node_modules/@react-pdf/**/*",
      "./node_modules/fontkit/**/*",
      "./node_modules/@swc/helpers/**/*",
    ],
    // step 8 공개 서명 표면 — 완료 이메일 첨부·교부 라우트도 PDF를 렌더한다.
    "/api/sign/[token]": [
      "./public/fonts/Pretendard-Regular.ttf",
      "./node_modules/@react-pdf/**/*",
      "./node_modules/fontkit/**/*",
      "./node_modules/@swc/helpers/**/*",
    ],
    "/api/sign/[token]/pdf": [
      "./public/fonts/Pretendard-Regular.ttf",
      "./node_modules/@react-pdf/**/*",
      "./node_modules/fontkit/**/*",
      "./node_modules/@swc/helpers/**/*",
    ],
    "/api/sign/[token]/certificate": [
      "./public/fonts/Pretendard-Regular.ttf",
      "./node_modules/@react-pdf/**/*",
      "./node_modules/fontkit/**/*",
      "./node_modules/@swc/helpers/**/*",
    ],
  },
};

export default nextConfig;

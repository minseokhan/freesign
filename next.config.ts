import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

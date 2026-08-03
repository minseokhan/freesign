import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/contracts",
          "/invoices",
          // 공개 청구서 토큰 표면(0046) — 레이아웃 noindex와 이중 방어.
          "/invoice/",
          "/clients",
          "/settings",
          "/reports",
          "/billing",
          "/api/",
          "/auth/",
          "/dev/",
        ],
      },
    ],
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}

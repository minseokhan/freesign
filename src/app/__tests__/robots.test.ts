import { describe, expect, it } from "vitest";

import robots from "../robots";

const PRIVATE_PATHS = [
  "/dashboard",
  "/contracts",
  "/invoices",
  "/clients",
  "/settings",
  "/reports",
  "/api/",
  "/auth/",
  "/dev/",
];

describe("robots.txt", () => {
  it("공개 페이지는 허용하고 인증 뒤 경로는 차단한다", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const rule = rules[0];

    expect(rule?.allow).toContain("/");
    for (const path of PRIVATE_PATHS) {
      expect(rule?.disallow).toContain(path);
    }
  });

  it("sitemap 절대 URL을 노출한다", () => {
    const result = robots();

    expect(result.sitemap).toMatch(/^https?:\/\/.+\/sitemap\.xml$/);
  });
});

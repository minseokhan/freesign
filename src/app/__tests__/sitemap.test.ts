import { describe, expect, it } from "vitest";

import sitemap from "../sitemap";

describe("sitemap.xml", () => {
  it("공개 페이지만 포함한다 (랜딩, 로그인, 고지 문서)", () => {
    const entries = sitemap();
    const paths = entries.map((entry) => new URL(entry.url).pathname);

    expect(paths).toEqual([
      "/",
      "/login",
      "/legal/privacy",
      "/legal/terms",
      "/legal/refund",
    ]);
  });

  it("모든 URL이 절대 URL이다", () => {
    for (const entry of sitemap()) {
      expect(entry.url).toMatch(/^https?:\/\//);
    }
  });

  it("인증 뒤 경로는 포함하지 않는다", () => {
    const urls = sitemap()
      .map((entry) => entry.url)
      .join(" ");

    expect(urls).not.toContain("/dashboard");
    expect(urls).not.toContain("/contracts");
    expect(urls).not.toContain("/invoices");
  });
});

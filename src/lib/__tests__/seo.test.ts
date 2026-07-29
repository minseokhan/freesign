import { describe, expect, it } from "vitest";

import {
  buildFaqJsonLd,
  buildSoftwareApplicationJsonLd,
  FALLBACK_SITE_URL,
  resolveSiteUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "../seo";

describe("resolveSiteUrl", () => {
  it("NEXT_PUBLIC_SITE_URL 값이 있으면 그대로 사용한다", () => {
    expect(resolveSiteUrl("https://example.com")).toBe("https://example.com");
  });

  it("후행 슬래시는 제거한다", () => {
    expect(resolveSiteUrl("https://example.com/")).toBe("https://example.com");
  });

  it("값이 없으면 프로덕션 URL로 폴백한다", () => {
    expect(resolveSiteUrl(undefined)).toBe(FALLBACK_SITE_URL);
    expect(resolveSiteUrl("")).toBe(FALLBACK_SITE_URL);
  });
});

describe("buildSoftwareApplicationJsonLd", () => {
  it("schema.org SoftwareApplication 구조를 생성한다", () => {
    const jsonLd = buildSoftwareApplicationJsonLd();

    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("SoftwareApplication");
    expect(jsonLd.name).toBe("FreeSign");
    expect(jsonLd.url).toMatch(/^https?:\/\//);
    expect(jsonLd.applicationCategory).toBe("BusinessApplication");
    expect(jsonLd.inLanguage).toBe("ko");
  });

  it("직렬화 가능한 순수 객체다", () => {
    expect(() => JSON.stringify(buildSoftwareApplicationJsonLd())).not.toThrow();
  });
});

describe("buildFaqJsonLd", () => {
  const items = [
    { question: "법적 효력이 있나요?", answer: "쌍방 서명과 타임스탬프를 남깁니다." },
    { question: "상대방도 가입해야 하나요?", answer: "아니요, 메일 링크로 서명합니다." },
  ];

  it("schema.org FAQPage 구조로 문답을 감싼다", () => {
    const jsonLd = buildFaqJsonLd(items);

    expect(jsonLd["@type"]).toBe("FAQPage");
    expect(jsonLd.mainEntity).toHaveLength(2);
    expect(jsonLd.mainEntity[0]).toMatchObject({
      "@type": "Question",
      name: "법적 효력이 있나요?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "쌍방 서명과 타임스탬프를 남깁니다.",
      },
    });
  });

  it("직렬화 가능한 순수 객체다", () => {
    expect(() => JSON.stringify(buildFaqJsonLd(items))).not.toThrow();
  });
});

describe("SEO 상수", () => {
  it("사이트 이름과 설명이 한국어 카테고리 키워드를 포함한다", () => {
    expect(SITE_NAME).toBe("FreeSign");
    expect(SITE_DESCRIPTION).toContain("프리랜서");
    expect(SITE_DESCRIPTION).toContain("계약");
  });
});

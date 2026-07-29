import { PRO_PRICE_KRW } from "@/lib/plan-features";

export const FALLBACK_SITE_URL = "https://freesign.vercel.app";

export const SITE_NAME = "FreeSign";

export const SITE_TITLE = "FreeSign — 프리랜서 계약·정산 올인원";

export const SITE_DESCRIPTION =
  "프리랜서를 위한 전자계약·정산 서비스. 계약서 작성과 전자서명, 인보이스 청구, 입금·미수금 관리, 세금 정리까지 하나의 흐름으로 관리하세요.";

/** 배포 도메인 교체 시 NEXT_PUBLIC_SITE_URL만 바꾸면 되도록 단일 지점에서 해석한다. */
export function resolveSiteUrl(raw: string | undefined): string {
  if (!raw) {
    return FALLBACK_SITE_URL;
  }

  return raw.replace(/\/+$/, "");
}

export function getSiteUrl(): string {
  return resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
}

/** 랜딩 FAQ JSON-LD (schema.org FAQPage). 문답은 화면에 보이는 것과 동일해야 한다. */
export function buildFaqJsonLd(
  items: readonly { question: string; answer: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  } as const;
}

/** 랜딩 페이지 JSON-LD (schema.org SoftwareApplication). */
export function buildSoftwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: getSiteUrl(),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "ko",
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: "0",
        priceCurrency: "KRW",
      },
      {
        "@type": "Offer",
        name: "Pro",
        price: String(PRO_PRICE_KRW),
        priceCurrency: "KRW",
      },
    ],
  } as const;
}

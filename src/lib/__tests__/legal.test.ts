import { describe, expect, it } from "vitest";

import {
  COLLECTED_DATA,
  DATA_PROCESSORS,
  LEGAL,
  LEGAL_TODO,
  listUnfilledLegalFields,
} from "@/lib/legal";

describe("LEGAL 상수", () => {
  it("모든 문자열 값이 비어 있지 않다", () => {
    const values = [
      LEGAL.serviceName,
      LEGAL.operatorName,
      LEGAL.representative,
      LEGAL.businessRegistrationNumber,
      LEGAL.mailOrderSalesNumber,
      LEGAL.address,
      LEGAL.contactEmail,
      LEGAL.privacyOfficer.name,
      LEGAL.privacyOfficer.email,
      LEGAL.privacyEffectiveDate,
      LEGAL.termsEffectiveDate,
      LEGAL.refundEffectiveDate,
    ];

    for (const value of values) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it("서비스명은 확정값이라 placeholder가 아니다", () => {
    expect(LEGAL.serviceName).toBe("FreeSign");
    expect(LEGAL.serviceName).not.toContain(LEGAL_TODO);
  });
});

describe("listUnfilledLegalFields", () => {
  it("placeholder가 남은 필드 경로를 모두 반환한다", () => {
    const unfilled = listUnfilledLegalFields();

    expect(unfilled).toContain("operatorName");
    expect(unfilled).toContain("businessRegistrationNumber");
    expect(unfilled).toContain("privacyOfficer.name");
    expect(unfilled).not.toContain("serviceName");
  });

  // 이 테스트는 "아직 채우지 않았다"를 박제한다. 사업자 등록·도메인 확정 후 값을 채우면
  // 여기가 깨지고, 그때 3개 고지 페이지의 문구·시행일도 함께 재확인하라는 신호가 된다.
  // (결제를 켜기 전 반드시 통과해야 하는 관문 — docs/LEGAL_ACCOUNT_PLAN.md 7절)
  it("[의도된 실패 예정] 현재는 사업자 정보가 아직 미기입 상태다", () => {
    expect(listUnfilledLegalFields().length).toBeGreaterThan(0);
  });
});

describe("DATA_PROCESSORS", () => {
  it("실제로 개인정보가 흐르는 국외 위탁사를 모두 담는다", () => {
    const names = DATA_PROCESSORS.map((processor) => processor.name);

    // 각 항목은 코드에 실재하는 의존성이다 — package.json·services/·lib/에서 확인 가능.
    expect(names).toContain("Supabase");
    expect(names).toContain("Vercel");
    expect(names).toContain("Anthropic");
    expect(names).toContain("Resend");
    expect(names).toContain("Polar");
    expect(names).toContain("PostHog");
    expect(names).toContain("freeTSA.org");
  });

  it("위탁 항목은 사실 기반이라 placeholder 없이 전부 기입돼 있다", () => {
    for (const processor of DATA_PROCESSORS) {
      expect(processor.purpose).not.toContain(LEGAL_TODO);
      expect(processor.items).not.toContain(LEGAL_TODO);
      expect(processor.country.trim().length).toBeGreaterThan(0);
      expect(processor.retention.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("COLLECTED_DATA", () => {
  it("코드가 실제로 저장하는 카테고리를 모두 고지한다", () => {
    const categories = COLLECTED_DATA.map((entry) => entry.category);

    expect(categories).toContain("계정");
    expect(categories).toContain("프로필");
    expect(categories).toContain("이용자가 입력한 제3자 정보");
    expect(categories).toContain("전자서명");
    expect(categories).toContain("결제");
    expect(categories).toContain("자동 수집");
  });

  it("제3자 정보 항목은 수탁 관계를 명시한다", () => {
    const thirdParty = COLLECTED_DATA.find(
      (entry) => entry.category === "이용자가 입력한 제3자 정보",
    );

    expect(thirdParty).toBeDefined();
    expect(thirdParty?.note).toContain("수탁");
  });
});

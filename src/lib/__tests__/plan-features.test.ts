import { describe, expect, it } from "vitest";

import { FREE_FEATURES, PRO_FEATURES, PRO_PRICE_KRW } from "../plan-features";
import { CREATE_FREE_LIMIT, IMPORT_FREE_LIMIT, SIGN_FREE_LIMIT } from "../plan";

describe("plan-features", () => {
  it("Free 목록의 상한 문구가 plan.ts 상수에서 파생된다", () => {
    const joined = FREE_FEATURES.join("\n");

    expect(joined).toContain(`새 계약 작성 ${CREATE_FREE_LIMIT}건`);
    expect(joined).toContain(`서명 요청 발송 ${SIGN_FREE_LIMIT}건`);
    expect(joined).toContain(`누적 ${IMPORT_FREE_LIMIT}회`);
  });

  it("Pro 목록은 Free에 없는 자동화 기능만 담는다", () => {
    expect(PRO_FEATURES).toContain("반복 인보이스 자동 초안");
    expect(PRO_FEATURES).toContain("미수금 자동 독촉 메일 초안");

    for (const feature of PRO_FEATURES) {
      expect(FREE_FEATURES).not.toContain(feature);
    }
  });

  it("월 구독료는 원화 정수로 노출한다", () => {
    expect(PRO_PRICE_KRW).toBe(14900);
    expect(Number.isSafeInteger(PRO_PRICE_KRW)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { computeNextRun } from "../schedule";

describe("computeNextRun weekly", () => {
  it("7일 뒤로 전진한다", () => {
    expect(computeNextRun("2026-07-01", "weekly")).toBe("2026-07-08");
  });

  it("월 경계를 넘는다", () => {
    expect(computeNextRun("2026-07-28", "weekly")).toBe("2026-08-04");
  });

  it("연말 경계를 넘는다", () => {
    expect(computeNextRun("2026-12-30", "weekly")).toBe("2027-01-06");
  });
});

describe("computeNextRun monthly", () => {
  it("같은 일자로 다음 달로 전진한다", () => {
    expect(computeNextRun("2026-07-15", "monthly")).toBe("2026-08-15");
  });

  it("12월은 다음 해 1월로 넘어간다", () => {
    expect(computeNextRun("2026-12-15", "monthly")).toBe("2027-01-15");
  });

  it("월말(31일)은 짧은 달의 마지막 날로 클램프한다", () => {
    expect(computeNextRun("2026-01-31", "monthly")).toBe("2026-02-28");
  });

  it("윤년 2월은 29일로 클램프한다", () => {
    expect(computeNextRun("2028-01-31", "monthly")).toBe("2028-02-29");
  });

  it("30일 달 경계(1/30 → 2/28)", () => {
    expect(computeNextRun("2026-01-30", "monthly")).toBe("2026-02-28");
  });
});

describe("computeNextRun 검증", () => {
  it("잘못된 날짜 포맷은 예외", () => {
    expect(() => computeNextRun("2026/07/01", "weekly")).toThrow();
  });
});

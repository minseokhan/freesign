import { describe, expect, it } from "vitest";

import {
  RECURRING_FILTERS,
  RECURRING_FILTER_OPTIONS,
  parseRecurringFilter,
} from "@/lib/recurring/filter";

describe("parseRecurringFilter", () => {
  it("defaults to all for missing or unknown values", () => {
    expect(parseRecurringFilter(undefined)).toBe("all");
    expect(parseRecurringFilter("")).toBe("all");
    expect(parseRecurringFilter("archived")).toBe("all");
  });

  it("keeps the known filters", () => {
    expect(parseRecurringFilter("all")).toBe("all");
    expect(parseRecurringFilter("active")).toBe("active");
    expect(parseRecurringFilter("paused")).toBe("paused");
  });
});

describe("RECURRING_FILTER_OPTIONS", () => {
  it("exposes 전체·활성·일시중지 in that order", () => {
    expect(RECURRING_FILTER_OPTIONS).toEqual([
      { value: "all", label: "전체" },
      { value: "active", label: "활성" },
      { value: "paused", label: "일시중지" },
    ]);
  });

  it("covers every filter value", () => {
    expect(RECURRING_FILTER_OPTIONS.map((option) => option.value)).toEqual([
      ...RECURRING_FILTERS,
    ]);
  });
});

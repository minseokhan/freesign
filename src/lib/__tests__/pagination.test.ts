import { describe, expect, it } from "vitest";

import {
  PAGE_SIZE,
  getPageItems,
  getRangeForPage,
  getTotalPages,
  parsePage,
} from "@/lib/pagination";

describe("parsePage", () => {
  it("defaults to page 1 when missing", () => {
    expect(parsePage(undefined)).toBe(1);
  });

  it("parses a valid page number", () => {
    expect(parsePage("3")).toBe(3);
  });

  it("clamps values below 1 to 1", () => {
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-5")).toBe(1);
  });

  it("falls back to 1 for non-numeric or fractional input", () => {
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("1.5")).toBe(1);
    expect(parsePage("")).toBe(1);
  });
});

describe("getTotalPages", () => {
  it("returns 1 when there are no items", () => {
    expect(getTotalPages(0)).toBe(1);
  });

  it("returns 1 when items fit on a single page", () => {
    expect(getTotalPages(PAGE_SIZE)).toBe(1);
  });

  it("rounds up partial pages", () => {
    expect(getTotalPages(PAGE_SIZE + 1)).toBe(2);
    expect(getTotalPages(PAGE_SIZE * 2 + 1)).toBe(3);
  });
});

describe("getRangeForPage", () => {
  it("computes the inclusive supabase range for page 1", () => {
    expect(getRangeForPage(1)).toEqual({ from: 0, to: PAGE_SIZE - 1 });
  });

  it("computes the inclusive range for later pages", () => {
    expect(getRangeForPage(3)).toEqual({
      from: PAGE_SIZE * 2,
      to: PAGE_SIZE * 3 - 1,
    });
  });
});

describe("getPageItems", () => {
  it("lists every page when the total is small", () => {
    expect(getPageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a single page when there is only one", () => {
    expect(getPageItems(1, 1)).toEqual([1]);
  });

  it("inserts an ellipsis near the end when on an early page", () => {
    expect(getPageItems(1, 10)).toEqual([1, 2, 3, "ellipsis", 10]);
  });

  it("inserts an ellipsis near the start when on a late page", () => {
    expect(getPageItems(10, 10)).toEqual([1, "ellipsis", 8, 9, 10]);
  });

  it("inserts ellipses on both sides in the middle", () => {
    expect(getPageItems(5, 10)).toEqual([1, "ellipsis", 4, 5, 6, "ellipsis", 10]);
  });
});

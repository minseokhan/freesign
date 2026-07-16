import { describe, it, expect } from "vitest";
import { aggregate } from "./aggregate.ts";
import type { CaseResult } from "./types.ts";

const r = (id: string, track: "review" | "qa", verdict: "pass" | "fail"): CaseResult => ({
  id,
  track,
  verdict,
  reason: "",
  subjectOutput: "",
});

describe("aggregate", () => {
  it("전부 통과하면 exitCode 0", () => {
    const s = aggregate([r("a", "review", "pass"), r("b", "qa", "pass")]);
    expect(s.exitCode).toBe(0);
    expect(s.passed).toBe(2);
    expect(s.failed).toBe(0);
    expect(s.failures).toEqual([]);
  });

  it("하나라도 실패하면 exitCode 1", () => {
    const s = aggregate([r("a", "review", "pass"), r("b", "qa", "fail")]);
    expect(s.exitCode).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.failures.map((f) => f.id)).toEqual(["b"]);
  });

  it("트랙별로 집계한다", () => {
    const s = aggregate([
      r("a", "review", "pass"),
      r("b", "review", "fail"),
      r("c", "qa", "pass"),
    ]);
    expect(s.byTrack.review).toEqual({ total: 2, passed: 1, failed: 1 });
    expect(s.byTrack.qa).toEqual({ total: 1, passed: 1, failed: 0 });
  });

  it("빈 결과는 exitCode 1 (게이트가 헛돌지 않도록)", () => {
    const s = aggregate([]);
    expect(s.total).toBe(0);
    expect(s.exitCode).toBe(1);
  });
});

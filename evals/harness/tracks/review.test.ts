import { vi, describe, it, expect, beforeEach } from "vitest";

// 네트워크 호출을 막고 오케스트레이션 배선만 검증(키 불필요).
vi.mock("../lib/anthropic.ts", () => ({
  SUBJECT_MODEL: "sonnet-test",
  JUDGE_MODEL: "opus-test",
  complete: vi.fn(),
}));

import { complete } from "../lib/anthropic.ts";
import { runReviewCase } from "./review.ts";
import { loadProjectRules } from "../lib/rules-file.ts";
import type { ParsedCase } from "../lib/types.ts";

const mockComplete = vi.mocked(complete);
const rules = loadProjectRules();

const violationCase: ParsedCase = {
  id: "review-01",
  track: "review",
  body: "await supabase.from('invoices').update(...)",
  expect: "violation",
  rule: "write-boundary",
};

beforeEach(() => mockComplete.mockReset());

describe("runReviewCase", () => {
  it("subject→judge 순으로 호출하고 judge 판정을 CaseResult로 매핑한다", async () => {
    mockComplete
      .mockResolvedValueOnce('{"violations":[{"rule":"write-boundary","evidence":"..."}]}')
      .mockResolvedValueOnce('{"verdict":"pass","reason":"위반을 정확히 지목"}');

    const res = await runReviewCase(violationCase, rules);

    expect(res).toMatchObject({ id: "review-01", track: "review", verdict: "pass" });
    expect(mockComplete).toHaveBeenCalledTimes(2);
    // 첫 호출은 피험(Sonnet), 둘째는 judge(Opus)
    expect(mockComplete.mock.calls[0][0].model).toBe("sonnet-test");
    expect(mockComplete.mock.calls[1][0].model).toBe("opus-test");
    // judge 프롬프트에 피험 출력이 전달된다
    expect(mockComplete.mock.calls[1][0].user).toContain("write-boundary");
  });

  it("judge가 fail이면 verdict fail 을 그대로 반영한다", async () => {
    mockComplete
      .mockResolvedValueOnce('{"violations":[]}')
      .mockResolvedValueOnce('{"verdict":"fail","reason":"위반을 놓침"}');

    const res = await runReviewCase(violationCase, rules);
    expect(res.verdict).toBe("fail");
    expect(res.reason).toContain("놓침");
  });
});

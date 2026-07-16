import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../lib/anthropic.ts", () => ({
  SUBJECT_MODEL: "sonnet-test",
  JUDGE_MODEL: "opus-test",
  complete: vi.fn(),
}));

import { complete } from "../lib/anthropic.ts";
import { runQaCase } from "./qa.ts";
import type { ParsedCase } from "../lib/types.ts";

const mockComplete = vi.mocked(complete);

const qaCase: ParsedCase = {
  id: "qa-02",
  track: "qa",
  body: "인가는 무엇으로 확인하나?",
  must: ["getUser()"],
  must_not: ["getSession()"],
};

beforeEach(() => mockComplete.mockReset());

describe("runQaCase", () => {
  it("라이브 CLAUDE.md 를 피험 시스템 프롬프트에 넣고 judge 판정을 매핑한다", async () => {
    mockComplete
      .mockResolvedValueOnce("getUser()를 씁니다")
      .mockResolvedValueOnce('{"verdict":"pass","reason":"must 충족"}');

    const res = await runQaCase(qaCase, "# CLAUDE.md 규약 본문");

    expect(res).toMatchObject({ id: "qa-02", track: "qa", verdict: "pass" });
    // 피험 시스템 프롬프트에 넘긴 CLAUDE.md 가 들어간다
    expect(mockComplete.mock.calls[0][0].system).toContain("CLAUDE.md 규약 본문");
    // judge 프롬프트에 must/must_not 과 응답이 들어간다
    expect(mockComplete.mock.calls[1][0].user).toContain("getSession()");
    expect(mockComplete.mock.calls[1][0].user).toContain("getUser()를 씁니다");
  });
});

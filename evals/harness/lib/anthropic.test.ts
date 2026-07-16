import { describe, it, expect } from "vitest";
import { textFromContent, SUBJECT_MODEL, JUDGE_MODEL } from "./anthropic.ts";

describe("textFromContent", () => {
  it("text 블록들을 이어붙인다", () => {
    expect(
      textFromContent([
        { type: "text", text: "가" },
        { type: "text", text: "나" },
      ]),
    ).toBe("가나");
  });

  it("text 아닌 블록은 무시한다", () => {
    expect(
      textFromContent([
        { type: "tool_use", id: "x", name: "y", input: {} },
        { type: "text", text: "다" },
      ]),
    ).toBe("다");
  });

  it("빈 콘텐츠는 빈 문자열", () => {
    expect(textFromContent([])).toBe("");
  });
});

describe("모델 상수", () => {
  it("피험=Sonnet, judge=Opus 로 분리한다", () => {
    expect(SUBJECT_MODEL).toContain("sonnet");
    expect(JUDGE_MODEL).toContain("opus");
  });
});

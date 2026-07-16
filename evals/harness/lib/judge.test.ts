import { describe, it, expect } from "vitest";
import { parseJudgeVerdict } from "./judge.ts";

describe("parseJudgeVerdict", () => {
  it("순수 JSON을 파싱한다", () => {
    expect(parseJudgeVerdict('{"verdict":"pass","reason":"규칙 위반을 정확히 지목함"}')).toEqual({
      verdict: "pass",
      reason: "규칙 위반을 정확히 지목함",
    });
  });

  it("코드펜스로 감싼 JSON도 파싱한다", () => {
    const raw = '설명\n```json\n{"verdict":"fail","reason":"놓침"}\n```';
    expect(parseJudgeVerdict(raw)).toEqual({ verdict: "fail", reason: "놓침" });
  });

  it("본문에 섞인 첫 JSON 오브젝트를 추출한다", () => {
    const raw = '판정: {"verdict":"pass","reason":"ok"} 끝';
    expect(parseJudgeVerdict(raw).verdict).toBe("pass");
  });

  it("verdict가 pass|fail 이 아니면 던진다", () => {
    expect(() => parseJudgeVerdict('{"verdict":"maybe","reason":"x"}')).toThrow(/verdict/);
  });

  it("JSON이 아예 없으면 던진다", () => {
    expect(() => parseJudgeVerdict("그냥 산문")).toThrow();
  });
});

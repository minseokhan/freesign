import { describe, it, expect } from "vitest";
import {
  REVIEW_SYSTEM_PROMPT,
  buildReviewSubjectUser,
  buildQaSubjectSystem,
  buildReviewJudgePrompt,
  buildQaJudgePrompt,
} from "./prompts.ts";
import type { ParsedCase } from "./types.ts";

describe("REVIEW_SYSTEM_PROMPT", () => {
  it("핵심 CRITICAL 경계를 담는다", () => {
    expect(REVIEW_SYSTEM_PROMPT).toContain("Server Action");
    expect(REVIEW_SYSTEM_PROMPT).toContain("service_role");
    expect(REVIEW_SYSTEM_PROMPT).toContain("getUser");
  });
  it("JSON 출력을 지시한다", () => {
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/JSON/);
  });

  it("정상 패턴을 위반으로 오탐하지 않도록 가드한다", () => {
    // getUser()·FK 소유권 재조회·서버측 status 세팅은 위반이 아님을 명시해야 오탐이 준다.
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/위반으로 보고하지 말/);
    expect(REVIEW_SYSTEM_PROMPT).toContain("소유권 재조회");
    // 읽기가 RLS로 user_id 스코프됨을 명시해야 FK 재조회에 명시적 user_id 필터가 없다는 오탐이 준다.
    expect(REVIEW_SYSTEM_PROMPT).toContain("RLS");
  });
});

describe("buildReviewSubjectUser", () => {
  it("리뷰 대상 코드를 담는다", () => {
    expect(buildReviewSubjectUser("const x = 1")).toContain("const x = 1");
  });
});

describe("buildQaSubjectSystem", () => {
  it("라이브 CLAUDE.md 전문을 컨텍스트로 넣는다", () => {
    const md = "# 매듭\n- 규칙 A";
    const sys = buildQaSubjectSystem(md);
    expect(sys).toContain("규칙 A");
  });
});

describe("buildReviewJudgePrompt", () => {
  const c: ParsedCase = {
    id: "review-01",
    track: "review",
    body: "코드",
    expect: "violation",
    rule: "write-boundary",
  };
  it("기대 라벨과 리뷰어 출력을 함께 담는다", () => {
    const p = buildReviewJudgePrompt(c, "위반입니다");
    expect(p).toContain("violation");
    expect(p).toContain("write-boundary");
    expect(p).toContain("위반입니다");
  });
});

describe("buildQaJudgePrompt", () => {
  const c: ParsedCase = {
    id: "qa-01",
    track: "qa",
    body: "질문?",
    must: ["getUser()"],
    must_not: ["getSession()"],
  };
  it("must/must_not 와 응답을 함께 담는다", () => {
    const p = buildQaJudgePrompt(c, "getUser()를 씁니다");
    expect(p).toContain("getUser()");
    expect(p).toContain("getSession()");
    expect(p).toContain("getUser()를 씁니다");
  });
});

import { describe, it, expect } from "vitest";
import { parseFrontmatter, parseCase } from "./parse.ts";

describe("parseFrontmatter", () => {
  it("스칼라 key: value 를 파싱한다", () => {
    expect(parseFrontmatter("id: review-01\ntrack: review")).toEqual({
      id: "review-01",
      track: "review",
    });
  });

  it("key: 뒤 - item 리스트를 파싱한다", () => {
    const fm = parseFrontmatter("must:\n  - 첫째\n  - 둘째\nid: qa-01");
    expect(fm.must).toEqual(["첫째", "둘째"]);
    expect(fm.id).toBe("qa-01");
  });

  it("따옴표를 벗긴다", () => {
    expect(parseFrontmatter('a: "값"\nb:\n  - \'항목\'')).toEqual({
      a: "값",
      b: ["항목"],
    });
  });

  it("빈 줄과 주석을 건너뛴다", () => {
    expect(parseFrontmatter("# 주석\n\nid: x")).toEqual({ id: "x" });
  });

  it("스칼라가 나오면 리스트 모드를 종료한다", () => {
    const fm = parseFrontmatter("must:\n  - a\nid: y");
    expect(fm).toEqual({ must: ["a"], id: "y" });
  });

  it("파싱 불가한 줄은 던진다", () => {
    expect(() => parseFrontmatter("이건 키가 아님")).toThrow();
  });
});

describe("parseCase", () => {
  const reviewViolation = `---
id: review-01
track: review
expect: violation
rule: write-boundary
---
클라이언트 컴포넌트에서 supabase.insert 직접 호출`;

  const reviewPass = `---
id: review-05
track: review
expect: pass
---
getUser()로 user_id를 얻는 Server Action`;

  const qa = `---
id: qa-02
track: qa
must:
  - getUser()
must_not:
  - getSession()
---
서버 인가는 무엇으로 확인하나?`;

  it("review 위반 케이스를 파싱한다", () => {
    const c = parseCase(reviewViolation);
    expect(c).toMatchObject({
      id: "review-01",
      track: "review",
      expect: "violation",
      rule: "write-boundary",
    });
    expect(c.body).toContain("supabase.insert");
  });

  it("review 정상 케이스는 rule 없이 파싱된다", () => {
    const c = parseCase(reviewPass);
    expect(c.expect).toBe("pass");
    expect(c.rule).toBeUndefined();
  });

  it("qa 케이스의 must/must_not 을 리스트로 파싱한다", () => {
    const c = parseCase(qa);
    expect(c.must).toEqual(["getUser()"]);
    expect(c.must_not).toEqual(["getSession()"]);
  });

  it("frontmatter 블록이 없으면 던진다", () => {
    expect(() => parseCase("본문만 있음")).toThrow(/frontmatter/);
  });

  it("track이 review|qa 가 아니면 던진다", () => {
    expect(() => parseCase("---\nid: x\ntrack: bogus\n---\n본문")).toThrow(/track/);
  });

  it("본문이 비면 던진다", () => {
    expect(() => parseCase("---\nid: x\ntrack: qa\nmust:\n  - a\nmust_not:\n  - b\n---\n")).toThrow(
      /본문/,
    );
  });

  it("review expect 라벨이 잘못되면 던진다", () => {
    expect(() => parseCase("---\nid: x\ntrack: review\nexpect: maybe\n---\n코드")).toThrow(/expect/);
  });

  it("violation인데 rule이 없으면 던진다", () => {
    expect(() => parseCase("---\nid: x\ntrack: review\nexpect: violation\n---\n코드")).toThrow(/rule/);
  });

  it("qa인데 must가 비면 던진다", () => {
    expect(() =>
      parseCase("---\nid: x\ntrack: qa\nmust:\nmust_not:\n  - b\n---\n질문"),
    ).toThrow(/must/);
  });
});

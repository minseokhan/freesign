// .claude/rules.json 파서·파생 로직 테스트 — 순수 함수만(파일 시스템 없음).
// 실제 파일과의 대조(드리프트 게이트)는 rules-sync.test.ts 담당.

import { describe, expect, it } from "vitest";

import {
  buildAxisRubric,
  buildEvalRubric,
  criticalBullets,
  parseRules,
  rulesForAxis,
  uncoveredBullets,
} from "@/lib/review/rules";

const FIXTURE = {
  generated_from: ["CLAUDE.md"],
  stack: ["Next.js"],
  axis_notes: { correctness: "반올림·통화 포맷 경계를 함께 본다." },
  rules: [
    {
      slug: "write-boundary",
      severity: "critical",
      axis: "architecture",
      rule: "쓰기는 Server Action에서만.",
      detail: "revalidatePath로 갱신.",
      ok_patterns: ["Server Action 안에서의 insert"],
      source_excerpt: "쓰기는 Server Actions에서만",
      eval_cases: ["review-02"],
    },
    {
      slug: "rls-scope",
      severity: "critical",
      axis: "security",
      rule: "USING + WITH CHECK 둘 다 스코프.",
      source_excerpt: "WITH CHECK (user_id = (select auth.uid()))",
      static_rule_ids: ["SR-04"],
    },
    {
      slug: "layer-separation",
      severity: "major",
      axis: "architecture",
      rule: "순수 함수는 lib/에.",
      source_excerpt: "순수 함수는 `lib/`",
    },
  ],
};

describe("parseRules", () => {
  it("정상 파일을 파싱한다", () => {
    const file = parseRules(FIXTURE);
    expect(file.rules).toHaveLength(3);
    expect(file.rules[0].slug).toBe("write-boundary");
    expect(file.axis_notes?.correctness).toContain("반올림");
  });

  it("슬러그가 중복이면 던진다 — 층마다 다른 규칙을 가리키게 된다", () => {
    const dup = { ...FIXTURE, rules: [FIXTURE.rules[0], FIXTURE.rules[0]] };
    expect(() => parseRules(dup)).toThrow(/중복/);
  });

  it("필수 필드가 없으면 던진다", () => {
    const bad = { ...FIXTURE, rules: [{ slug: "x", severity: "critical", axis: "security" }] };
    expect(() => parseRules(bad)).toThrow(/rule/);
  });

  it("source_excerpt가 없으면 던진다 — 문서 앵커가 없으면 드리프트를 못 잡는다", () => {
    const noAnchor = { ...FIXTURE.rules[0], source_excerpt: undefined };
    expect(() => parseRules({ ...FIXTURE, rules: [noAnchor] })).toThrow(/source_excerpt/);
  });

  it("허용되지 않은 severity·axis는 던진다", () => {
    const badSeverity = { ...FIXTURE, rules: [{ ...FIXTURE.rules[0], severity: "nit" }] };
    expect(() => parseRules(badSeverity)).toThrow(/severity/);
    const badAxis = { ...FIXTURE, rules: [{ ...FIXTURE.rules[0], axis: "perf" }] };
    expect(() => parseRules(badAxis)).toThrow(/axis/);
  });
});

describe("rulesForAxis", () => {
  it("축으로 거른다", () => {
    const file = parseRules(FIXTURE);
    expect(rulesForAxis(file, "architecture").map((r) => r.slug)).toEqual([
      "write-boundary",
      "layer-separation",
    ]);
    expect(rulesForAxis(file, "security").map((r) => r.slug)).toEqual(["rls-scope"]);
  });
});

describe("buildAxisRubric", () => {
  it("해당 축 규칙만 담고 다른 축은 빼며, 심각도를 표시한다", () => {
    const rubric = buildAxisRubric(parseRules(FIXTURE), "architecture");
    expect(rubric).toContain("[write-boundary]");
    expect(rubric).toContain("쓰기는 Server Action에서만.");
    expect(rubric).toContain("[layer-separation]");
    expect(rubric).toContain("CRITICAL");
    expect(rubric).not.toContain("[rls-scope]");
  });

  it("정상 패턴과 축 노트를 함께 싣는다 — 오탐 억제분이 파생에서 빠지면 안 된다", () => {
    const file = parseRules(FIXTURE);
    expect(buildAxisRubric(file, "architecture")).toContain("Server Action 안에서의 insert");
    expect(buildAxisRubric(file, "correctness")).toContain("반올림·통화 포맷 경계");
  });
});

describe("buildEvalRubric", () => {
  it("critical 규칙만 슬러그 표기로 싣는다", () => {
    const rubric = buildEvalRubric(parseRules(FIXTURE));
    expect(rubric).toContain("[write-boundary]");
    expect(rubric).toContain("[rls-scope]");
    expect(rubric).not.toContain("[layer-separation]");
  });

  it("정상 패턴을 별도 섹션으로 모은다", () => {
    const rubric = buildEvalRubric(parseRules(FIXTURE));
    expect(rubric).toContain("정상 패턴");
    expect(rubric).toContain("Server Action 안에서의 insert");
  });
});

describe("criticalBullets", () => {
  const doc = [
    "## 아키텍처 규칙",
    "- CRITICAL: 쓰기는 Server Actions에서만.",
    "- CRITICAL: RLS는 USING + WITH CHECK 둘 다.",
    "- 서버 인가는 getUser().",
    "npm run build:verify  # CRITICAL: 컴파일 확인은 이쪽",
  ].join("\n");

  it("CRITICAL 불릿만 뽑는다", () => {
    expect(criticalBullets(doc)).toEqual([
      "CRITICAL: 쓰기는 Server Actions에서만.",
      "CRITICAL: RLS는 USING + WITH CHECK 둘 다.",
    ]);
  });

  it("불릿이 아닌 CRITICAL 언급(명령어 주석)은 규칙으로 세지 않는다", () => {
    expect(criticalBullets(doc).join("\n")).not.toContain("build:verify");
  });
});

describe("uncoveredBullets", () => {
  it("어떤 규칙도 앵커하지 못한 불릿을 돌려준다", () => {
    const file = parseRules(FIXTURE);
    const bullets = [
      "CRITICAL: 쓰기는 Server Actions에서만 한다.",
      "CRITICAL: 크론은 클라이언트에게 직접 발송하지 않는다.",
    ];
    expect(uncoveredBullets(bullets, file)).toEqual([
      "CRITICAL: 크론은 클라이언트에게 직접 발송하지 않는다.",
    ]);
  });
});

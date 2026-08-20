// 드리프트 게이트 — 규칙 정본(.claude/rules.json)과 각 실행 층이 갈라졌는지 키 없이 검사한다.
//
// 왜 있나: 규칙은 CLAUDE.md에 산문으로 적히지만 실행 층마다 형태가 달라(정규식 스캐너·리뷰
// 프롬프트·eval 루브릭) 사본이 늘어난다. 실제로 보안 개선에서 CRITICAL 3개를 문서에 추가했는데
// 리뷰 프롬프트에는 반영되지 않아, 그 경계를 깨는 PR을 리뷰가 통과시킬 수 있는 상태였다.
// 이 테스트는 "문서에만 있고 기계 층엔 없는 규칙"을 npm test에서 빨간불로 만든다.

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REVIEW_AXES,
  buildAxisRubric,
  buildEvalRubric,
  criticalBullets,
  parseRules,
  uncoveredBullets,
  type RulesFile,
} from "@/lib/review/rules";
import { STATIC_RULE_IDS } from "@/lib/review/static-rules";

import { CASES_DIR, loadCases } from "./lib/cases.ts";
import { buildReviewSystemPrompt } from "./lib/prompts.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const RULES: RulesFile = parseRules(JSON.parse(read(".claude/rules.json")));
const DOCS = ["CLAUDE.md", "AGENTS.md"] as const;
/** 코드 리뷰가 잡을 수 있는 규칙만. process 축(TDD)은 diff 스캔 대상이 아니다. */
const CODE_CRITICAL = RULES.rules.filter((r) => r.severity === "critical" && r.axis !== "process");

describe("정본 ↔ 규약 문서", () => {
  it("모든 규칙의 source_excerpt가 문서에 실재한다", () => {
    for (const doc of DOCS) {
      const text = read(doc);
      const missing = RULES.rules.filter((r) => !text.includes(r.source_excerpt)).map((r) => r.slug);
      expect(missing, `${doc}에서 앵커를 잃은 규칙`).toEqual([]);
    }
  });

  it("문서의 CRITICAL 불릿이 모두 규칙으로 옮겨져 있다", () => {
    for (const doc of DOCS) {
      expect(uncoveredBullets(criticalBullets(read(doc)), RULES), `${doc}에만 있는 규칙`).toEqual([]);
    }
  });

  it("CLAUDE.md와 AGENTS.md가 같은 규칙 집합을 담는다", () => {
    const slugsOf = (doc: string) => {
      const text = read(doc);
      return RULES.rules.filter((r) => text.includes(r.source_excerpt)).map((r) => r.slug).sort();
    };
    expect(slugsOf("AGENTS.md")).toEqual(slugsOf("CLAUDE.md"));
  });
});

describe("정본 ↔ 정적 스캐너", () => {
  it("규칙이 지목한 SR-xx가 스캐너에 실재한다", () => {
    const declared = RULES.rules.flatMap((r) => r.static_rule_ids ?? []);
    expect(declared.filter((id) => !STATIC_RULE_IDS.includes(id))).toEqual([]);
  });

  it("스캐너의 모든 규칙이 어떤 규칙 슬러그에 매핑돼 있다", () => {
    const declared = new Set(RULES.rules.flatMap((r) => r.static_rule_ids ?? []));
    expect(STATIC_RULE_IDS.filter((id) => !declared.has(id))).toEqual([]);
  });
});

describe("정본 ↔ eval 골든셋", () => {
  const cases = loadCases(CASES_DIR);
  const caseIds = new Set(cases.map((c) => c.id));
  const slugs = new Set(RULES.rules.map((r) => r.slug));

  it("규칙이 지목한 eval 케이스가 실재한다", () => {
    const dangling = RULES.rules.flatMap((r) => (r.eval_cases ?? []).filter((id) => !caseIds.has(id)));
    expect(dangling).toEqual([]);
  });

  it("케이스 라벨의 rule 슬러그가 정본에 있고, 정본도 그 케이스를 지목한다", () => {
    for (const c of cases) {
      if (!c.rule) continue;
      expect(slugs.has(c.rule), `${c.id}의 rule '${c.rule}'가 rules.json에 없음`).toBe(true);
      const owner = RULES.rules.find((r) => r.slug === c.rule);
      expect(owner?.eval_cases ?? [], `${c.rule}가 ${c.id}를 지목하지 않음`).toContain(c.id);
    }
  });

  it("코드 CRITICAL 규칙은 eval 케이스나 정적 스캐너 중 하나로 검증된다", () => {
    const unchecked = CODE_CRITICAL.filter(
      (r) => (r.eval_cases ?? []).length === 0 && (r.static_rule_ids ?? []).length === 0,
    ).map((r) => r.slug);
    expect(unchecked).toEqual([]);
  });
});

describe("정본 ↔ 파생 루브릭", () => {
  it("eval 리뷰 루브릭이 코드 CRITICAL 규칙을 빠짐없이 담는다", () => {
    const prompt = buildReviewSystemPrompt(RULES);
    expect(CODE_CRITICAL.filter((r) => !prompt.includes(`[${r.slug}]`)).map((r) => r.slug)).toEqual([]);
  });

  it("리뷰 스킬 3축 루브릭이 코드 CRITICAL 규칙을 빠짐없이 담는다", () => {
    const rubric = REVIEW_AXES.map((a) => buildAxisRubric(RULES, a)).join("\n");
    expect(CODE_CRITICAL.filter((r) => !rubric.includes(`[${r.slug}]`)).map((r) => r.slug)).toEqual([]);
  });

  it("eval 루브릭은 CRITICAL만 담는다 — major까지 넣으면 골든셋 라벨과 어긋난다", () => {
    const prompt = buildEvalRubric(RULES);
    const major = RULES.rules.filter((r) => r.severity === "major");
    expect(major.filter((r) => prompt.includes(`[${r.slug}]`)).map((r) => r.slug)).toEqual([]);
  });
});

describe("리뷰 스킬 배선", () => {
  it("스킬이 규칙을 하드코딩하지 않고 정본에서 받아 쓴다", () => {
    const skill = read(".claude/skills/review-code/SKILL.md");
    expect(skill).toContain(".claude/rules.json");
    expect(skill).toContain("npm run review:rubric");
  });
});

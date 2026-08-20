// 골든셋 무결성·균형 검사 — 키 없이 npm test 로 돈다.
// 라벨은 사람이 박제한다는 원칙을 기계가 지켜주는 가드레일:
// 트랙 구성이 무너지거나(오탐 방지 케이스 소실 등) id가 겹치면 여기서 막힌다.

import { describe, it, expect } from "vitest";
import { loadCases, CASES_DIR } from "../lib/cases.ts";
import { buildReviewSystemPrompt } from "../lib/prompts.ts";
import { loadProjectRules } from "../lib/rules-file.ts";

const cases = loadCases(CASES_DIR);
const REVIEW_SYSTEM_PROMPT = buildReviewSystemPrompt(loadProjectRules());
const review = cases.filter((c) => c.track === "review");
const qa = cases.filter((c) => c.track === "qa");

describe("골든셋 무결성", () => {
  it("id 는 전역에서 유일하다", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("두 트랙 모두 케이스가 존재한다", () => {
    expect(review.length).toBeGreaterThan(0);
    expect(qa.length).toBeGreaterThan(0);
  });
});

describe("review 트랙 균형", () => {
  it("위반 케이스가 4개 이상이다", () => {
    const violations = review.filter((c) => c.expect === "violation");
    expect(violations.length).toBeGreaterThanOrEqual(4);
  });

  it("오탐 방지용 정상(pass) 케이스가 1개 이상이다", () => {
    const passes = review.filter((c) => c.expect === "pass");
    expect(passes.length).toBeGreaterThanOrEqual(1);
  });

  it("모든 위반 케이스는 rule 슬러그를 가진다", () => {
    for (const c of review.filter((c) => c.expect === "violation")) {
      expect(c.rule, `${c.id} 에 rule 없음`).toBeTruthy();
    }
  });

  // 피험 모델은 리뷰 루브릭의 슬러그만 출력할 수 있고, judge 는 슬러그 일치를
  // 요구한다(lib/prompts.ts). 루브릭에 없는 슬러그를 라벨로 달면 그 케이스는 모델 성능과
  // 무관하게 영구 fail 이 되는데, "rule 이 있는가"만 보면 이게 통과해 버린다(실제로 통과했다).
  it("모든 위반 케이스의 rule 은 리뷰 루브릭에 실재하는 슬러그다", () => {
    const rubricSlugs = new Set(
      [...REVIEW_SYSTEM_PROMPT.matchAll(/^\[([a-z0-9-]+)\]/gm)].map((m) => m[1]),
    );

    // 루브릭 파싱 자체가 깨지면(형식 변경) 아래 검사가 무의미해지므로 먼저 막는다.
    expect(rubricSlugs.size).toBeGreaterThan(0);

    for (const c of review.filter((c) => c.expect === "violation")) {
      expect(
        rubricSlugs.has(c.rule!),
        `${c.id} 의 rule "${c.rule}" 이 루브릭에 없음 — 루브릭에 추가하거나 라벨을 고칠 것 (현재 루브릭: ${[...rubricSlugs].join(", ")})`,
      ).toBe(true);
    }
  });
});

describe("qa 트랙 균형", () => {
  it("모든 케이스는 must / must_not 사실을 가진다", () => {
    for (const c of qa) {
      expect(c.must?.length, `${c.id} must 비어있음`).toBeGreaterThan(0);
      expect(c.must_not?.length, `${c.id} must_not 비어있음`).toBeGreaterThan(0);
    }
  });

  it("틀린 전제를 반박하는 가드 케이스가 1개 이상이다", () => {
    const guards = qa.filter((c) => c.guard === "false-premise");
    expect(guards.length).toBeGreaterThanOrEqual(1);
  });
});

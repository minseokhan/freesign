// 골든셋 무결성·균형 검사 — 키 없이 npm test 로 돈다.
// 라벨은 사람이 박제한다는 원칙을 기계가 지켜주는 가드레일:
// 트랙 구성이 무너지거나(오탐 방지 케이스 소실 등) id가 겹치면 여기서 막힌다.

import { describe, it, expect } from "vitest";
import { loadCases, CASES_DIR } from "../lib/cases.ts";

const cases = loadCases(CASES_DIR);
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

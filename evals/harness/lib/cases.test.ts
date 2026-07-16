import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadCases, CASES_DIR } from "./cases.ts";

describe("loadCases", () => {
  it("골든셋 디렉터리의 모든 .md 를 파싱해 로드한다", () => {
    const cases = loadCases(CASES_DIR);
    expect(cases.length).toBeGreaterThan(0);
    // 파싱은 loadCases 내부에서 검증되므로, 로드 성공 자체가 무결성 통과.
    for (const c of cases) {
      expect(c.id).toBeTruthy();
      expect(["review", "qa"]).toContain(c.track);
    }
  });

  it("id 로 정렬되어 결정적 순서를 준다", () => {
    const ids = loadCases(CASES_DIR).map((c) => c.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it("존재하지 않는 디렉터리는 던진다", () => {
    expect(() => loadCases(path.join(CASES_DIR, "__nope__"))).toThrow();
  });
});

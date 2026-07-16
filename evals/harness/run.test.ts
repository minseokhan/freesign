import { describe, it, expect } from "vitest";
import { mapPool } from "./run.ts";

describe("mapPool", () => {
  it("결과 순서를 입력 순서대로 보존한다", async () => {
    const out = await mapPool([1, 2, 3, 4], 2, async (x) => x * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("동시 실행 수가 limit을 넘지 않는다", async () => {
    let active = 0;
    let peak = 0;
    const work = async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      await Promise.resolve();
      active--;
    };
    await mapPool([1, 2, 3, 4, 5, 6], 2, work);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("빈 입력은 빈 결과", async () => {
    expect(await mapPool([], 4, async (x) => x)).toEqual([]);
  });
});

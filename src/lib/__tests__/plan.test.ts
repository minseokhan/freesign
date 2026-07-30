import { describe, expect, it, vi } from "vitest";

import {
  CREATE_FREE_LIMIT,
  GATE_UNAVAILABLE,
  IMPORT_FREE_LIMIT,
  canCreateContract,
  canSendSignature,
  derivePlan,
  mapPolarStatusToPlan,
  type SubscriptionRow,
} from "@/lib/plan";

const NOW = new Date("2026-07-21T00:00:00.000Z");
const FUTURE = "2026-08-21T00:00:00.000Z";
const PAST = "2026-06-21T00:00:00.000Z";

function sub(overrides: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    plan: "pro",
    status: "active",
    current_period_end: FUTURE,
    cancel_at_period_end: false,
    ...overrides,
  };
}

describe("derivePlan", () => {
  it("행이 없으면 free", () => {
    expect(derivePlan(null, NOW)).toBe("free");
  });

  it("pro·active·기간 유효면 pro", () => {
    expect(derivePlan(sub({}), NOW)).toBe("pro");
  });

  it("기간이 만료됐으면 free로 강등", () => {
    expect(derivePlan(sub({ current_period_end: PAST }), NOW)).toBe("free");
  });

  it("취소 예정이지만 기간이 남았으면 pro 유지(유예)", () => {
    expect(
      derivePlan(
        sub({ cancel_at_period_end: true, current_period_end: FUTURE }),
        NOW,
      ),
    ).toBe("pro");
  });

  it("취소 예정이고 기간도 지났으면 free", () => {
    expect(
      derivePlan(
        sub({ cancel_at_period_end: true, current_period_end: PAST }),
        NOW,
      ),
    ).toBe("free");
  });

  it("plan이 free면 free", () => {
    expect(derivePlan(sub({ plan: "free" }), NOW)).toBe("free");
  });

  it("revoked 상태면 기간과 무관하게 free(즉시 강등)", () => {
    expect(
      derivePlan(sub({ status: "revoked", current_period_end: FUTURE }), NOW),
    ).toBe("free");
  });

  it("current_period_end가 null이면 만료 없음으로 보고 pro", () => {
    expect(derivePlan(sub({ current_period_end: null }), NOW)).toBe("pro");
  });
});

describe("mapPolarStatusToPlan", () => {
  it("active → pro", () => {
    expect(mapPolarStatusToPlan("active")).toEqual({
      plan: "pro",
      status: "active",
    });
  });

  it("trialing → pro", () => {
    expect(mapPolarStatusToPlan("trialing").plan).toBe("pro");
  });

  it("past_due → pro(유예)", () => {
    expect(mapPolarStatusToPlan("past_due").plan).toBe("pro");
  });

  it("canceled → free", () => {
    expect(mapPolarStatusToPlan("canceled").plan).toBe("free");
  });

  it("unpaid → free", () => {
    expect(mapPolarStatusToPlan("unpaid").plan).toBe("free");
  });

  it("알 수 없는 상태 → free(안전 기본값)", () => {
    expect(mapPolarStatusToPlan("something_weird").plan).toBe("free");
  });
});

describe("무료 티어 상한 상수", () => {
  it("불러오기 파싱은 누적 5회", () => {
    expect(IMPORT_FREE_LIMIT).toBe(5);
  });

  it("새 계약 생성은 1건", () => {
    expect(CREATE_FREE_LIMIT).toBe(1);
  });
});

// #41: count 쿼리 오류를 무시하면 (null ?? 0) < 1 이 참이 되어 무료 상한이 조용히 사라진다.
describe("무료 게이트 fail-closed", () => {
  function supabaseWithContractCount(result: { count: number | null; error: unknown }) {
    const contractsQuery = {
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then(resolve: (value: unknown) => void) {
        return Promise.resolve(result).then(resolve);
      },
    };

    return {
      from: vi.fn((table: string) => {
        if (table === "subscriptions") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }

        return contractsQuery;
      }),
    } as never;
  }

  it("계약 생성 게이트는 count 오류 시 거부한다", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await canCreateContract(
      supabaseWithContractCount({ count: null, error: { message: "timeout" } }),
      "user-1",
    );

    expect(result).toEqual({
      ok: false,
      plan: "free",
      reason: "create_limit",
      message: GATE_UNAVAILABLE,
    });
    consoleError.mockRestore();
  });

  it("서명 발송 게이트도 count 오류 시 거부한다", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await canSendSignature(
      supabaseWithContractCount({ count: null, error: null }),
      "user-1",
    );

    expect(result.ok).toBe(false);
    consoleError.mockRestore();
  });

  it("정상 count는 그대로 통과시킨다(회귀)", async () => {
    const result = await canCreateContract(
      supabaseWithContractCount({ count: 0, error: null }),
      "user-1",
    );

    expect(result).toEqual({ ok: true, plan: "free" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { assertOwned } from "@/lib/db";
import { assertProFeature } from "@/lib/plan";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  createRecurringSchedule,
  deleteRecurringSchedule,
  setRecurringActive,
} from "../actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/plan", () => ({ assertProFeature: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, assertOwned: vi.fn() };
});
vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: () => ({ capture: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }),
}));

const user = { id: "user-1", email: "me@test" };
const validInput = {
  contract_id: "11111111-1111-4111-8111-111111111111",
  amount: 1_000_000,
  withholding_type: "wt_3_3",
  interval_kind: "monthly",
  next_run_at: "2026-08-01",
  due_offset_days: 14,
};

function tableBuilder(single: unknown) {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    is: vi.fn(() => b),
    insert: vi.fn(() => b),
    update: vi.fn(() => b),
    delete: vi.fn(() => b),
    single: vi.fn(() => Promise.resolve({ data: single, error: null })),
    maybeSingle: vi.fn(() => Promise.resolve({ data: single, error: null })),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  });
  return b;
}

describe("createRecurringSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(user as never);
    vi.mocked(assertProFeature).mockResolvedValue({ ok: true, plan: "pro" });
    vi.mocked(assertOwned).mockResolvedValue(true);
  });

  it("free 플랜이면 차단", async () => {
    vi.mocked(assertProFeature).mockResolvedValue({
      ok: false, plan: "free", reason: "pro_only", message: "Pro 전용",
    });
    const res = await createRecurringSchedule(validInput);
    expect(res.ok).toBe(false);
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it("pro면 계약 소유 검증 후 세금 스냅샷과 함께 삽입한다", async () => {
    const builders: Record<string, unknown> = {
      contracts: tableBuilder({ client_id: "cli-1", status: "active" }),
      recurring_invoices: tableBuilder({ id: "rec-1" }),
    };
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn((t: string) => builders[t]),
    } as never);

    const res = await createRecurringSchedule(validInput);
    expect(res).toEqual({ ok: true, id: "rec-1" });
    expect((builders.recurring_invoices as { insert: ReturnType<typeof vi.fn> }).insert)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user-1",
          client_id: "cli-1",
          interval_kind: "monthly",
          withholding_amount: expect.any(Number),
          net_amount: expect.any(Number),
        }),
      );
  });

  it("소유하지 않은 계약이면 실패", async () => {
    vi.mocked(assertOwned).mockResolvedValue(false);
    const res = await createRecurringSchedule(validInput);
    expect(res.ok).toBe(false);
  });

  it("잘못된 입력이면 검증 실패", async () => {
    const res = await createRecurringSchedule({ ...validInput, amount: -1 });
    expect(res.ok).toBe(false);
  });
});

describe("setRecurringActive / deleteRecurringSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(user as never);
    vi.mocked(assertOwned).mockResolvedValue(true);
  });

  it("pause는 active=false로 업데이트(게이트 없음 — 본인 데이터 관리)", async () => {
    const builder = tableBuilder({ id: "rec-1" });
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn(() => builder),
    } as never);

    const res = await setRecurringActive("22222222-2222-4222-8222-222222222222", false);
    expect(res.ok).toBe(true);
    expect((builder as { update: ReturnType<typeof vi.fn> }).update)
      .toHaveBeenCalledWith({ active: false });
  });

  it("delete는 소유 검증 후 삭제", async () => {
    const builder = tableBuilder({ id: "rec-1" });
    vi.mocked(createSupabaseClient).mockResolvedValue({
      from: vi.fn(() => builder),
    } as never);

    const res = await deleteRecurringSchedule("22222222-2222-4222-8222-222222222222");
    expect(res.ok).toBe(true);
    expect((builder as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalled();
  });
});

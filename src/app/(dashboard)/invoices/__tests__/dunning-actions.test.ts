import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { assertProFeature } from "@/lib/plan";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getEmailProvider } from "@/services/email/provider";

import { approveAndSendDunning, dismissDunning } from "../dunning-actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/plan", () => ({ assertProFeature: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/services/email/provider", () => ({ getEmailProvider: vi.fn() }));
vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: () => ({ capture: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }),
}));

const user = { id: "user-1", email: "me@test" };
const reminderId = "11111111-1111-4111-8111-111111111111";

function tableBuilder(single: unknown) {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    is: vi.fn(() => b),
    update: vi.fn(() => b),
    insert: vi.fn(() => b),
    maybeSingle: vi.fn(() => Promise.resolve({ data: single, error: null })),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  });
  return b;
}

function makeSupabase(rows: {
  reminder: unknown;
  invoice: unknown;
  client: unknown;
}) {
  const builders: Record<string, unknown> = {
    dunning_reminders: tableBuilder(rows.reminder),
    invoices: tableBuilder(rows.invoice),
    clients: tableBuilder(rows.client),
  };
  // 0036: 발송 이력은 invoice_events 직접 INSERT가 아니라 append_invoice_event RPC로 남긴다.
  const rpc = vi.fn(() => Promise.resolve({ data: "event-1", error: null }));
  return { from: vi.fn((t: string) => builders[t]), rpc, _builders: builders, _rpc: rpc };
}

describe("approveAndSendDunning", () => {
  const send = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(user as never);
    vi.mocked(assertProFeature).mockResolvedValue({ ok: true, plan: "pro" });
    vi.mocked(getEmailProvider).mockReturnValue({ send } as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
    send.mockResolvedValue({ ok: true });
  });

  it("free 플랜이면 차단한다(이메일 발송 없음)", async () => {
    vi.mocked(assertProFeature).mockResolvedValue({
      ok: false,
      plan: "free",
      reason: "pro_only",
      message: "Pro 전용",
    });

    const res = await approveAndSendDunning(reminderId);
    expect(res.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it("pro + 미검토 초안이면 클라이언트에 발송하고 sent로 전이한다", async () => {
    const supabase = makeSupabase({
      reminder: {
        id: reminderId,
        status: "pending_review",
        draft_subject: "제목",
        draft_body: "본문",
        invoice_id: "inv-1",
        ai_source: "ai",
      },
      invoice: { id: "inv-1", payment_status: "unpaid", client_id: "cli-1" },
      client: { contact_email: "client@acme.test" },
    });
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase as never);

    const res = await approveAndSendDunning(reminderId);
    expect(res.ok).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "client@acme.test" }),
    );
    expect((supabase._builders.dunning_reminders as { update: ReturnType<typeof vi.fn> }).update)
      .toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
    expect(supabase._rpc).toHaveBeenCalledWith(
      "append_invoice_event",
      expect.objectContaining({
        p_invoice_id: "inv-1",
        p_event_type: "invoice.dunning_sent",
      }),
    );
  });

  it("클라이언트 이메일이 없으면 발송하지 않고 실패", async () => {
    const supabase = makeSupabase({
      reminder: { id: reminderId, status: "pending_review", draft_subject: "s", draft_body: "b", invoice_id: "inv-1", ai_source: "ai" },
      invoice: { id: "inv-1", payment_status: "unpaid", client_id: "cli-1" },
      client: { contact_email: null },
    });
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase as never);

    const res = await approveAndSendDunning(reminderId);
    expect(res.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("이미 정산된 인보이스면 발송하지 않는다", async () => {
    const supabase = makeSupabase({
      reminder: { id: reminderId, status: "pending_review", draft_subject: "s", draft_body: "b", invoice_id: "inv-1", ai_source: "ai" },
      invoice: { id: "inv-1", payment_status: "paid", client_id: "cli-1" },
      client: { contact_email: "c@t.test" },
    });
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase as never);

    const res = await approveAndSendDunning(reminderId);
    expect(res.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("이메일 발송 실패 시 sent 전이하지 않는다", async () => {
    send.mockResolvedValue({ ok: false, error: "boom" });
    const supabase = makeSupabase({
      reminder: { id: reminderId, status: "pending_review", draft_subject: "s", draft_body: "b", invoice_id: "inv-1", ai_source: "ai" },
      invoice: { id: "inv-1", payment_status: "unpaid", client_id: "cli-1" },
      client: { contact_email: "c@t.test" },
    });
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase as never);

    const res = await approveAndSendDunning(reminderId);
    expect(res.ok).toBe(false);
    expect((supabase._builders.dunning_reminders as { update: ReturnType<typeof vi.fn> }).update)
      .not.toHaveBeenCalled();
  });
});

describe("dismissDunning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(user as never);
    vi.mocked(assertProFeature).mockResolvedValue({ ok: true, plan: "pro" });
  });

  it("free 플랜이면 차단", async () => {
    vi.mocked(assertProFeature).mockResolvedValue({
      ok: false, plan: "free", reason: "pro_only", message: "Pro 전용",
    });
    const res = await dismissDunning(reminderId);
    expect(res.ok).toBe(false);
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it("pro면 dismissed로 전이", async () => {
    const supabase = makeSupabase({ reminder: null, invoice: null, client: null });
    vi.mocked(createSupabaseClient).mockResolvedValue(supabase as never);
    const res = await dismissDunning(reminderId);
    expect(res.ok).toBe(true);
    expect((supabase._builders.dunning_reminders as { update: ReturnType<typeof vi.fn> }).update)
      .toHaveBeenCalledWith(expect.objectContaining({ status: "dismissed" }));
  });
});

// #26: 제3자(클라이언트) 메일함으로 나가는 발송 경로에 상한이 없었다.
describe("approveAndSendDunning 발송 상한", () => {
  const send = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(user as never);
    vi.mocked(assertProFeature).mockResolvedValue({ ok: true, plan: "pro" });
    vi.mocked(getEmailProvider).mockReturnValue({ send } as never);
    send.mockResolvedValue({ ok: true });
  });

  it("상한을 넘으면 메일을 보내지 않고 안내 문구를 반환한다", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfter: 42 });
    vi.mocked(createSupabaseClient).mockResolvedValue(
      makeSupabase({ reminder: null, invoice: null, client: null }) as never,
    );

    const res = await approveAndSendDunning(reminderId);

    expect(res).toEqual({
      ok: false,
      error: "독촉 발송이 잠시 제한되었어요. 42초 후 다시 시도해 주세요.",
    });
    expect(send).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith(RATE_LIMITS.dunningSend);
  });
});

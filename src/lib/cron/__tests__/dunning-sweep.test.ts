import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAnonClient } from "@/lib/supabase/anon";
import { generateDunningDraft } from "@/services/ai/dunning-draft";
import { getEmailProvider } from "@/services/email/provider";

import { runDunningSweep } from "../dunning-sweep";

vi.mock("@/lib/supabase/anon", () => ({ createAnonClient: vi.fn() }));
vi.mock("@/services/ai/dunning-draft", () => ({ generateDunningDraft: vi.fn() }));
vi.mock("@/services/email/provider", () => ({ getEmailProvider: vi.fn() }));
vi.mock("@/lib/seo", () => ({ getSiteUrl: () => "https://freesign.example" }));

const candidate = {
  reminder_id: "r-1",
  user_id: "u-1",
  invoice_id: "inv-1",
  client_name: "ACME",
  client_email: "client@acme.test",
  contract_title: "계약",
  net_amount: 1_000_000,
  due_date: "2026-07-01",
  days_overdue: 24,
  freelancer_name: "김프리",
  owner_email: "owner@me.test",
};

describe("runDunningSweep", () => {
  const send = vi.fn();
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAnonClient).mockReturnValue({ rpc } as never);
    vi.mocked(getEmailProvider).mockReturnValue({ send } as never);
    vi.mocked(generateDunningDraft).mockResolvedValue({
      subject: "제목",
      body: "본문",
      source: "ai",
    });
    send.mockResolvedValue({ ok: true });
  });

  it("후보별 초안 본문을 채우고 유저별 소유자 알림을 보낸다", async () => {
    rpc
      .mockResolvedValueOnce({ data: [candidate], error: null }) // create_drafts
      .mockResolvedValueOnce({ data: null, error: null }); // update_body

    const summary = await runDunningSweep("secret");

    expect(summary).toEqual({ candidates: 1, drafted: 1, ownersNotified: 1 });
    expect(rpc).toHaveBeenCalledWith(
      "update_dunning_draft_body",
      expect.objectContaining({ p_reminder_id: "r-1", p_source: "ai" }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@me.test" }),
    );
  });

  it("create RPC 오류는 throw한다(daily route가 격리)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "unauthorized cron call" } });
    await expect(runDunningSweep("bad")).rejects.toThrow();
  });

  it("후보가 없으면 알림을 보내지 않는다", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const summary = await runDunningSweep("secret");
    expect(summary).toEqual({ candidates: 0, drafted: 0, ownersNotified: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAnonClient } from "@/lib/supabase/anon";
import { getEmailProvider } from "@/services/email/provider";

import { runRecurringSweep } from "../recurring-sweep";

vi.mock("@/lib/supabase/anon", () => ({ createAnonClient: vi.fn() }));
vi.mock("@/services/email/provider", () => ({ getEmailProvider: vi.fn() }));
vi.mock("@/lib/seo", () => ({ getSiteUrl: () => "https://maedeup.example" }));

describe("runRecurringSweep", () => {
  const send = vi.fn();
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAnonClient).mockReturnValue({ rpc } as never);
    vi.mocked(getEmailProvider).mockReturnValue({ send } as never);
    send.mockResolvedValue({ ok: true });
  });

  it("생성된 draft를 유저별로 집계해 소유자 알림을 보낸다", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { invoice_id: "i1", user_id: "u1", owner_email: "a@t.test" },
        { invoice_id: "i2", user_id: "u1", owner_email: "a@t.test" },
        { invoice_id: "i3", user_id: "u2", owner_email: "b@t.test" },
      ],
      error: null,
    });

    const summary = await runRecurringSweep("secret");
    expect(summary).toEqual({ generated: 3, ownersNotified: 2 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("생성분이 없으면 알림을 보내지 않는다", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const summary = await runRecurringSweep("secret");
    expect(summary).toEqual({ generated: 0, ownersNotified: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("RPC 오류는 throw한다", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "unauthorized cron call" } });
    await expect(runRecurringSweep("bad")).rejects.toThrow();
  });
});

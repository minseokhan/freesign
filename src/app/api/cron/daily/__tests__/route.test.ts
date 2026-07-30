import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCronEnv } from "@/lib/env";
import { runDunningSweep } from "@/lib/cron/dunning-sweep";
import { runRecurringSweep } from "@/lib/cron/recurring-sweep";

import { GET } from "../route";

vi.mock("@/lib/env", () => ({
  getCronEnv: vi.fn(),
}));

const captureServerException = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/posthog-server", () => ({
  captureServerException: (...args: unknown[]) => captureServerException(...args),
}));

vi.mock("@/lib/cron/dunning-sweep", () => ({
  runDunningSweep: vi.fn(),
}));

vi.mock("@/lib/cron/recurring-sweep", () => ({
  runRecurringSweep: vi.fn(),
}));

function reqWith(header: string | null): Request {
  return new Request("https://freesign.example/api/cron/daily", {
    headers: header === null ? {} : { authorization: header },
  });
}

describe("GET /api/cron/daily", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCronEnv).mockReturnValue({ CRON_SECRET: "cron-secret" });
    vi.mocked(runDunningSweep).mockResolvedValue({
      candidates: 0,
      drafted: 0,
      ownersNotified: 0,
    });
    vi.mocked(runRecurringSweep).mockResolvedValue({
      generated: 0,
      ownersNotified: 0,
    });
  });

  it("시크릿 불일치면 401", async () => {
    const res = await GET(reqWith("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("Authorization 헤더 누락이면 401", async () => {
    const res = await GET(reqWith(null));
    expect(res.status).toBe(401);
  });

  it("시크릿 일치면 200 + 집계 JSON(dunning 스윕 실행)", async () => {
    const res = await GET(reqWith("Bearer cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(runDunningSweep).toHaveBeenCalledWith("cron-secret");
    expect(body.ran.dunning).toMatchObject({ ok: true });
  });

  // #37: 실패가 200 ok:true로 보고되면 Vercel Cron 모니터링이 성공으로 판정해
  // 잡이 며칠째 죽어 있어도 탐지되지 않는다.
  it("스윕이 throw하면 나머지는 진행하되 500 + ok:false로 보고한다", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runDunningSweep).mockRejectedValue(new Error("boom"));

    const res = await GET(reqWith("Bearer cron-secret"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.ran.dunning).toMatchObject({ ok: false, error: "boom" });
    // 실패해도 뒤 스윕은 계속 돈다.
    expect(runRecurringSweep).toHaveBeenCalled();
    expect(body.ran.recurring).toMatchObject({ ok: true });
    expect(errorSpy).toHaveBeenCalled();
    expect(captureServerException).toHaveBeenCalledWith(
      expect.any(Error),
      undefined,
      expect.objectContaining({ route: "cron/daily", sweep: "dunning" }),
    );
  });

  it("인가 거부를 로그로 남긴다(시크릿 값은 남기지 않는다)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await GET(reqWith("Bearer wrong"));

    expect(warnSpy).toHaveBeenCalledWith(
      "[cron] unauthorized",
      expect.objectContaining({ hasAuthorizationHeader: true }),
    );
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain("cron-secret");
  });
});

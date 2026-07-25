import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCronEnv } from "@/lib/env";
import { runDunningSweep } from "@/lib/cron/dunning-sweep";
import { runRecurringSweep } from "@/lib/cron/recurring-sweep";

import { GET } from "../route";

vi.mock("@/lib/env", () => ({
  getCronEnv: vi.fn(),
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

  it("스윕이 throw해도 200 + 해당 스윕만 실패로 격리한다", async () => {
    vi.mocked(runDunningSweep).mockRejectedValue(new Error("boom"));
    const res = await GET(reqWith("Bearer cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ran.dunning).toMatchObject({ ok: false });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { GET, runtime } from "../route";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const user = { id: "user-123", email: "freelancer@example.test" };

describe("GET /api/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
  });

  it("runs on node for server-only CSV generation", () => {
    expect(runtime).toBe("nodejs");
  });

  it("exports the tax ledger CSV from the report RPC with private download headers", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          paid_at: "2026-03-15T05:00:00.000Z",
          issue_date: "2026-03-01",
          client_name: "김클라",
          channel: "direct",
          amount: "1000000",
          withholding_type: "wt_3_3",
          withholding_amount: "33000",
          net_amount: 967000,
        },
      ],
      error: null,
    });
    vi.mocked(createSupabaseClient).mockResolvedValue({
      rpc,
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const response = await GET(new Request("http://localhost/api/reports?year=2026"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="freesign-report-2026.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(requireUser).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("get_report_tax_ledger", {
      report_year: 2026,
    });
    const body = new Uint8Array(await response.arrayBuffer());
    const expectedBody = new TextEncoder().encode(
      "﻿입금일,발행일,클라이언트,채널,청구액(원),원천징수유형,원천징수액(원),실지급액(원)\r\n" +
        "2026-03-15,2026-03-01,김클라,직거래,1000000,3.3%,33000,967000\r\n" +
        "합계,,,,1000000,,33000,967000",
    );

    expect(Array.from(body)).toEqual(Array.from(expectedBody));
  });

  it("rejects invalid years before querying Supabase", async () => {
    vi.mocked(createSupabaseClient).mockResolvedValue({
      rpc: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof createSupabaseClient>>);

    const response = await GET(new Request("http://localhost/api/reports?year=abcd"));

    expect(response.status).toBe(400);
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });
});

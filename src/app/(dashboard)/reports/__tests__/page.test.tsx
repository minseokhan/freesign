import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getUserPlan } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";

import ReportsPage from "../page";

// 리포트는 연도 파라미터 → RPC 인자 → 화면, 그리고 Pro 게이트가 얽힌 접합이다.
// lib/metrics.ts·lib/insights.ts 순수함수는 이미 커버돼 있어 여기선 접합만 본다.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/plan", () => ({ getUserPlan: vi.fn() }));

type Result<T> = { data: T | null; error: Error | null };

const ok = <T,>(data: T): Result<T> => ({ data, error: null });

type ReportData = {
  channel?: Result<unknown>;
  tax?: Result<unknown>;
  client?: Result<unknown>;
  outstanding?: Result<unknown>;
  insights?: Result<unknown>;
};

const paidChannelRows = ok([
  { channel: "direct", revenue: "2000000", total_revenue: "3000000" },
  { channel: "agency", revenue: "1000000", total_revenue: "3000000" },
]);

function createInsightQuery(result: Result<unknown>) {
  const query: Record<string, unknown> = {};

  for (const method of ["select", "order", "limit"]) {
    query[method] = vi.fn(() => query);
  }

  query.then = (onFulfilled: (value: Result<unknown>) => unknown) =>
    Promise.resolve(result).then(onFulfilled);

  return query;
}

function mockSupabase(data: ReportData) {
  const rpc = vi.fn((name: string) => {
    if (name === "get_report_channel_revenue") {
      return Promise.resolve(data.channel ?? ok([]));
    }

    if (name === "get_report_tax_summary") {
      return Promise.resolve(data.tax ?? ok([]));
    }

    if (name === "get_report_client_revenue") {
      return Promise.resolve(data.client ?? ok([]));
    }

    return Promise.resolve(data.outstanding ?? ok([]));
  });

  const from = vi.fn(() => createInsightQuery(data.insights ?? ok([])));

  vi.mocked(createClient).mockResolvedValue({ rpc, from } as unknown as Awaited<
    ReturnType<typeof createClient>
  >);

  return { rpc, from };
}

const searchParams = (params: { year?: string }) => Promise.resolve(params);

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserPlan).mockResolvedValue("pro");
    // 연도 기본값은 KST 기준 올해다 — 실행 날짜에 흔들리지 않게 고정한다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T03:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("선택 연도를 네 개의 리포트 RPC 인자로 그대로 넘긴다", async () => {
    const { rpc } = mockSupabase({});

    render(await ReportsPage({ searchParams: searchParams({ year: "2024" }) }));

    for (const name of [
      "get_report_channel_revenue",
      "get_report_tax_summary",
      "get_report_client_revenue",
      "get_report_outstanding",
    ]) {
      expect(rpc).toHaveBeenCalledWith(name, { report_year: 2024 });
    }
  });

  // 연도는 URL로 들어오는 클라이언트 입력이다 — 아무 값이나 SQL 인자로 흘리면 안 된다.
  it("범위 밖·비정수 연도는 KST 올해로 폴백한다", async () => {
    const { rpc } = mockSupabase({});

    render(await ReportsPage({ searchParams: searchParams({ year: "1800" }) }));
    expect(rpc).toHaveBeenCalledWith("get_report_tax_summary", { report_year: 2026 });

    vi.clearAllMocks();
    const second = mockSupabase({});

    render(await ReportsPage({ searchParams: searchParams({ year: "olleh" }) }));
    expect(second.rpc).toHaveBeenCalledWith("get_report_tax_summary", {
      report_year: 2026,
    });
  });

  it("연도 인자가 없으면 KST 올해를 쓴다", async () => {
    const { rpc } = mockSupabase({});

    render(await ReportsPage({ searchParams: searchParams({}) }));

    expect(rpc).toHaveBeenCalledWith("get_report_outstanding", { report_year: 2026 });
  });

  it("입금 데이터가 없으면 랭킹 대신 빈 상태를 보여준다", async () => {
    mockSupabase({});

    render(await ReportsPage({ searchParams: searchParams({}) }));

    expect(screen.getByText("해당 연도 입금 기록이 없어요")).toBeInTheDocument();
    expect(
      screen.getByText("해당 연도 입금 내역이 없어 표시할 세무 요약이 없습니다."),
    ).toBeInTheDocument();
  });

  it("Pro는 내보내기 링크에 선택 연도를 실어 보낸다", async () => {
    mockSupabase({ channel: paidChannelRows });

    render(await ReportsPage({ searchParams: searchParams({ year: "2025" }) }));

    expect(screen.getByRole("link", { name: "Excel 내보내기" })).toHaveAttribute(
      "href",
      "/api/reports?year=2025",
    );
  });

  it("Free는 내보내기 대신 업그레이드로 보낸다", async () => {
    vi.mocked(getUserPlan).mockResolvedValue("free");
    mockSupabase({ channel: paidChannelRows });

    render(await ReportsPage({ searchParams: searchParams({}) }));

    expect(screen.queryByRole("link", { name: "Excel 내보내기" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Excel 내보내기 (Pro)" }),
    ).toHaveAttribute("href", "/api/billing/checkout");
  });

  // Pro 게이트는 화면을 가리는 것으로 끝나면 안 된다 — 조회 자체가 일어나면 안 된다.
  it("Free에게는 계약 인사이트를 조회조차 하지 않는다", async () => {
    vi.mocked(getUserPlan).mockResolvedValue("free");
    const { from } = mockSupabase({ channel: paidChannelRows });

    render(await ReportsPage({ searchParams: searchParams({}) }));

    expect(from).not.toHaveBeenCalled();
    expect(screen.getByText("종합 계약 피드백 요약")).toBeInTheDocument();
  });

  it("Pro는 저장된 인사이트를 위험도 분포로 집계해 보여준다", async () => {
    const { from } = mockSupabase({
      channel: paidChannelRows,
      insights: ok([
        { risk_level: "high", findings: ["지연이자 조항 없음"] },
        { risk_level: "low", findings: [] },
      ]),
    });

    render(await ReportsPage({ searchParams: searchParams({}) }));

    expect(from).toHaveBeenCalledWith("contract_insights");
    expect(screen.getByText(/저장된 계약 인사이트 2건/)).toBeInTheDocument();
  });

  it("리포트 RPC 실패를 삼키지 않고 던진다", async () => {
    mockSupabase({ tax: { data: null, error: new Error("tax rpc failed") } });

    await expect(
      ReportsPage({ searchParams: searchParams({}) }),
    ).rejects.toThrow("tax rpc failed");
  });
});

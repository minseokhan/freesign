import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getUserPlan } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";

import DashboardPage from "../page";

// lib/metrics.ts 순수함수는 이미 단위 테스트가 있다. 여기서 재는 것은
// "집계 쿼리 결과를 화면에 어떻게 접합하는가" — 그 사이가 무테스트 구간이었다.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/plan", () => ({ getUserPlan: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

type Result<T> = { data: T | null; error: Error | null };

function createQuery(result: Result<unknown>) {
  const query: Record<string, unknown> = {};

  for (const method of ["select", "eq", "is", "order", "limit"]) {
    query[method] = vi.fn(() => query);
  }

  query.maybeSingle = vi.fn(() => Promise.resolve(result));
  // 인보이스 쿼리는 maybeSingle 없이 그대로 await 된다.
  query.then = (onFulfilled: (value: Result<unknown>) => unknown) =>
    Promise.resolve(result).then(onFulfilled);

  return query;
}

type DashboardData = {
  totals?: Result<unknown>;
  channels?: Result<unknown>;
  pipeline?: Result<unknown>;
  invoices?: Result<unknown>;
  demoClient?: Result<unknown>;
};

const ok = <T,>(data: T): Result<T> => ({ data, error: null });

// pg numeric은 supabase-js를 거치며 문자열로 온다 — 기본 픽스처를 일부러 문자열로 둔다.
const defaultTotals = ok([
  {
    outstanding_amount: "1200000",
    outstanding_count: "2",
    monthly_revenue: "3400000",
    monthly_paid_count: "3",
    expected_this_month_amount: "500000",
    expected_this_month_count: "1",
  },
]);

function mockSupabase(data: DashboardData) {
  const rpc = vi.fn((name: string) => {
    if (name === "get_dashboard_totals") {
      return Promise.resolve(data.totals ?? defaultTotals);
    }

    if (name === "get_dashboard_channel_revenue") {
      return Promise.resolve(data.channels ?? ok([]));
    }

    return Promise.resolve(data.pipeline ?? ok([]));
  });

  const from = vi.fn((table: string) =>
    createQuery(
      table === "invoices" ? (data.invoices ?? ok([])) : (data.demoClient ?? ok(null)),
    ),
  );

  vi.mocked(createClient).mockResolvedValue({ rpc, from } as unknown as Awaited<
    ReturnType<typeof createClient>
  >);

  return { rpc, from };
}

const unpaidInvoice = (id: string, dueDate: string, clientName: string) => ({
  id,
  amount: 1_000_000,
  due_date: dueDate,
  payment_status: "unpaid",
  client: { name: clientName },
  contract: { title: `${clientName} 계약` },
});

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserPlan).mockResolvedValue("pro");
    // deriveDueStatus는 KST 오늘을 기준으로 갈린다 — 실행 날짜에 흔들리지 않게 고정한다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T03:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // numeric이 문자열로 와도 금액이 되어야 한다. 접합이 깨지면 toAmount가 NaN을 내고
  // formatKRW가 "amount must be a safe integer"로 던져 페이지 전체가 죽는다.
  it("문자열로 오는 numeric 집계를 원화 금액으로 표시한다", async () => {
    mockSupabase({});

    render(await DashboardPage());

    const metrics = screen.getByRole("region", { name: "핵심 정산 지표" });
    expect(within(metrics).getByText("₩1,200,000")).toBeInTheDocument();
    expect(within(metrics).getByText("₩3,400,000")).toBeInTheDocument();
    expect(within(metrics).getByText("₩500,000")).toBeInTheDocument();
  });

  it("집계가 전부 0이면 지표 대신 빈 상태를 보여준다", async () => {
    mockSupabase({
      totals: ok([
        {
          outstanding_amount: "0",
          outstanding_count: "0",
          monthly_revenue: "0",
          monthly_paid_count: "0",
          expected_this_month_amount: "0",
          expected_this_month_count: "0",
        },
      ]),
    });

    render(await DashboardPage());

    expect(screen.getByText("아직 대시보드 데이터가 없어요")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "핵심 정산 지표" })).toBeNull();
  });

  // 미입금 인보이스를 전부 나열하면 "챙길 것" 목록이 아니라 그냥 목록이 된다.
  it("미입금 중 지연·임박만 챙길 목록에 남기고 여유분은 뺀다", async () => {
    mockSupabase({
      invoices: ok([
        unpaidInvoice("i1", "2026-08-01", "지연클라"),
        unpaidInvoice("i2", "2026-08-10", "임박클라"),
        unpaidInvoice("i3", "2026-12-31", "여유클라"),
      ]),
    });

    render(await DashboardPage());

    expect(screen.getByText("지연클라")).toBeInTheDocument();
    expect(screen.getByText("임박클라")).toBeInTheDocument();
    expect(screen.queryByText("여유클라")).toBeNull();
    expect(screen.getByText("지연")).toBeInTheDocument();
    expect(screen.getByText("임박")).toBeInTheDocument();
  });

  it("챙길 지급기한이 없으면 표 대신 빈 상태 문구를 보여준다", async () => {
    mockSupabase({ invoices: ok([unpaidInvoice("i3", "2026-12-31", "여유클라")]) });

    render(await DashboardPage());

    expect(screen.getByText(/챙길 지급기한이 없습니다/)).toBeInTheDocument();
  });

  // 집계 실패를 빈 화면으로 삼키면 "미수금 0원"으로 읽힌다 — 잘못된 안심이라 던져야 한다.
  it("집계 RPC 실패를 삼키지 않고 던진다", async () => {
    mockSupabase({ totals: { data: null, error: new Error("totals rpc failed") } });

    await expect(DashboardPage()).rejects.toThrow("totals rpc failed");
  });

  it("인보이스 조회 실패도 던진다", async () => {
    mockSupabase({ invoices: { data: null, error: new Error("invoice query failed") } });

    await expect(DashboardPage()).rejects.toThrow("invoice query failed");
  });

  it("free 플랜에만 업그레이드 카드를 노출한다", async () => {
    vi.mocked(getUserPlan).mockResolvedValue("free");
    mockSupabase({});

    const { unmount } = render(await DashboardPage());
    expect(screen.getByRole("link", { name: /업그레이드/ })).toBeInTheDocument();
    unmount();

    vi.mocked(getUserPlan).mockResolvedValue("pro");
    mockSupabase({});

    render(await DashboardPage());
    expect(screen.queryByRole("link", { name: /업그레이드/ })).toBeNull();
  });
});

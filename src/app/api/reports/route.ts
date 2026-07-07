import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import {
  getReportChannelLabel,
  serializeReportCsv,
  type ReportCsvRow,
} from "@/lib/reports-csv";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ReportChannelRevenue = {
  channel: string;
  revenue: number | string | null;
  total_revenue: number | string | null;
};

type ReportRpcClient = {
  rpc(
    functionName: "get_report_channel_revenue",
    args: { report_year: number },
  ): PromiseLike<{ data: ReportChannelRevenue[] | null; error: Error | null }>;
};

export async function GET(request: Request) {
  await requireUser();

  const yearResult = parseReportYear(new URL(request.url).searchParams.get("year"));

  if (!yearResult.ok) {
    return NextResponse.json(
      { error: "year는 2000부터 2100 사이의 정수여야 합니다." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const rpc = supabase as unknown as ReportRpcClient;
  const { data, error } = await rpc.rpc("get_report_channel_revenue", {
    report_year: yearResult.year,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows: ReportCsvRow[] = (data ?? []).map((row) => ({
    channel: row.channel,
    channelLabel: getReportChannelLabel(row.channel),
    revenue: toAmount(row.revenue),
  }));
  const csv = serializeReportCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="freesign-report-${yearResult.year}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}

function parseReportYear(value: string | null):
  | { ok: true; year: number }
  | { ok: false } {
  if (!value) {
    return { ok: false };
  }

  const year = Number(value);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { ok: false };
  }

  return { ok: true, year };
}

function toAmount(value: number | string | null | undefined) {
  if (value == null) {
    return 0;
  }

  return typeof value === "number" ? value : Number(value);
}

import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { serializeTaxLedgerCsv, type ReportLedgerRow } from "@/lib/reports-csv";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ReportLedgerRpcRow = {
  paid_at: string | null;
  issue_date: string | null;
  client_name: string | null;
  channel: string | null;
  amount: number | string | null;
  withholding_type: string | null;
  withholding_amount: number | string | null;
  net_amount: number | string | null;
};

type ReportRpcClient = {
  rpc(
    functionName: "get_report_tax_ledger",
    args: { report_year: number },
  ): PromiseLike<{ data: ReportLedgerRpcRow[] | null; error: Error | null }>;
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
  const { data, error } = await rpc.rpc("get_report_tax_ledger", {
    report_year: yearResult.year,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows: ReportLedgerRow[] = (data ?? []).map((row) => ({
    paidAt: row.paid_at ?? "",
    issueDate: row.issue_date ?? "",
    clientName: row.client_name ?? "",
    channel: row.channel ?? "other",
    amount: toAmount(row.amount),
    withholdingType: row.withholding_type ?? "none",
    withholdingAmount: toAmount(row.withholding_amount),
    netAmount: toAmount(row.net_amount),
  }));
  const csv = serializeTaxLedgerCsv(rows);

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

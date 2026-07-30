import { NextResponse } from "next/server";
import writeExcelFile from "write-excel-file/node";

import { requireUser } from "@/lib/auth";
import { assertProFeature } from "@/lib/plan";
import {
  captureServerException,
  getPostHogClient,
} from "@/lib/posthog-server";
import { buildTaxLedgerSheet, type ReportLedgerRow } from "@/lib/reports-xlsx";
import { createClient } from "@/lib/supabase/server";
import { GENERIC_API_ERROR } from "@/lib/api-error";

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
  const user = await requireUser();

  // 세금 리포트 CSV export는 Pro 전용(화면 조회는 무료).
  const proGate = await assertProFeature();
  if (!proGate.ok) {
    return NextResponse.json(
      { error: proGate.message, upsell: true },
      { status: 402 },
    );
  }

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
    await captureServerException(error, user.id, { route: "reports" });
    return NextResponse.json({ error: GENERIC_API_ERROR }, { status: 500 });
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
  const { sheetData, columns } = buildTaxLedgerSheet(rows, {
    year: yearResult.year,
    generatedAt: new Date().toISOString(),
  });
  const workbook = await writeExcelFile(sheetData, {
    columns,
    sheet: `${yearResult.year}년 세무 원장`,
  }).toBuffer();

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "report_exported", properties: { year: yearResult.year, row_count: rows.length } });
  await posthog.flush();

  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="freesign-report-${yearResult.year}.xlsx"`,
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

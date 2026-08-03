import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { assertOwned, notDeleted } from "@/lib/db";
import { mapBankAccount, mapInvoicePdfProps } from "@/lib/invoices/pdf";
import { renderInvoicePdf } from "@/lib/invoices/render-pdf";
import {
  captureServerException,
  getPostHogClient,
} from "@/lib/posthog-server";
import { createClient } from "@/lib/supabase/server";
import { GENERIC_API_ERROR } from "@/lib/api-error";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 30;

type InvoiceRow = Pick<
  Database["public"]["Tables"]["invoices"]["Row"],
  | "id"
  | "amount"
  | "issue_date"
  | "due_date"
  | "withholding_type"
  | "withholding_amount"
  | "net_amount"
  | "payment_status"
  | "paid_at"
> & {
  client: {
    name: string;
  } | null;
  contract: {
    title: string;
  } | null;
};

type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "bank_name" | "bank_account_number" | "bank_account_holder"
>;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const user = await requireUser();
  const { id } = await context.params;

  if (!id.trim()) {
    return NextResponse.json(
      { error: "인보이스를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const supabase = await createClient();
  const isOwned = await assertOwned(supabase, "invoices", id);

  if (!isOwned) {
    return NextResponse.json(
      { error: "인보이스를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const { data, error } = await notDeleted(
    supabase
      .from("invoices")
      .select(
        "id,amount,issue_date,due_date,withholding_type,withholding_amount,net_amount,payment_status,paid_at,client:clients(name),contract:contracts(title)",
      )
      .eq("id", id),
  ).maybeSingle();

  if (error) {
    await captureServerException(error, user.id, { route: "invoices/pdf" });
    return NextResponse.json({ error: GENERIC_API_ERROR }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "인보이스를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("bank_name,bank_account_number,bank_account_holder")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    await captureServerException(profileError, user.id, {
      route: "invoices/pdf",
    });
    return NextResponse.json({ error: GENERIC_API_ERROR }, { status: 500 });
  }

  const invoice = data as InvoiceRow;
  const profile = profileData as ProfileRow | null;
  const document = mapInvoicePdfProps({
    invoice,
    clientName: invoice.client?.name ?? null,
    contractTitle: invoice.contract?.title ?? null,
    bankAccount: mapBankAccount(profile),
  });
  const pdfBuffer = await renderInvoicePdf(document);

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "invoice_pdf_downloaded", properties: { invoice_id: invoice.id } });
  await posthog.flush();

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="invoice-${invoice.id}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}


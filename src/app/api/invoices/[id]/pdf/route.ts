import { createElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { InvoiceDocument } from "@/components/pdf/invoice-document";
import { requireUser } from "@/lib/auth";
import { assertOwned, notDeleted } from "@/lib/db";
import {
  type InvoicePdfBankAccount,
  mapInvoicePdfProps,
} from "@/lib/invoices/pdf";
import { createClient } from "@/lib/supabase/server";
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
    return NextResponse.json({ error: error.message }, { status: 500 });
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
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const invoice = data as InvoiceRow;
  const profile = profileData as ProfileRow | null;
  const document = mapInvoicePdfProps({
    invoice,
    clientName: invoice.client?.name ?? null,
    contractTitle: invoice.contract?.title ?? null,
    bankAccount: mapBankAccount(profile),
  });
  const pdfElement = createElement(InvoiceDocument, {
    document,
  }) as Parameters<typeof renderToBuffer>[0];
  const pdfBuffer = await renderToBuffer(pdfElement);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="invoice-${invoice.id}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}

function mapBankAccount(profile: ProfileRow | null): InvoicePdfBankAccount | null {
  if (
    !profile?.bank_name &&
    !profile?.bank_account_number &&
    !profile?.bank_account_holder
  ) {
    return null;
  }

  return {
    bankName: profile.bank_name ?? "등록되지 않음",
    accountNumber: profile.bank_account_number ?? "등록되지 않음",
    accountHolder: profile.bank_account_holder ?? "등록되지 않음",
  };
}

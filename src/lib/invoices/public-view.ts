// anon DEFINER RPC(get_invoice_view, 0046)의 jsonb 응답을 공개 인보이스 화면·PDF 입력으로
// 변환하는 순수 매핑. 공개 페이지와 토큰 PDF 라우트가 공유한다. 형식이 어긋나면 null(렌더 스킵).
import {
  mapBankAccount,
  mapInvoicePdfProps,
  type InvoicePdfDocument,
} from "@/lib/invoices/pdf";
import type { Database, Json } from "@/types/database";

export type InvoiceView =
  | { state: "expired" }
  | { state: "revoked" }
  | {
      state: "active";
      senderName: string | null;
      clientName: string | null;
      contractTitle: string;
      dueDate: string;
      netAmount: number;
      paymentStatus: Database["public"]["Enums"]["payment_status"];
      expiresAt: string | null;
      document: InvoicePdfDocument;
    };

type JsonObject = Record<string, Json | undefined>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: Json | undefined): number | null {
  return typeof value === "number" ? value : null;
}

const withholdingTypes = ["wt_3_3", "wt_8_8", "none"] as const;
const paymentStatuses = ["draft", "unpaid", "paid"] as const;

/** get_invoice_view 응답 → 공개 화면·PDF 모델. */
export function parseInvoiceView(data: unknown): InvoiceView | null {
  if (!isJsonObject(data)) {
    return null;
  }

  const state = asString(data.state);

  if (state === "expired" || state === "revoked") {
    return { state };
  }

  if (state !== "active") {
    return null;
  }

  const invoiceId = asString(data.invoice_id);
  const amount = asNumber(data.amount);
  const withholdingAmount = asNumber(data.withholding_amount);
  const netAmount = asNumber(data.net_amount);
  const issueDate = asString(data.issue_date);
  const dueDate = asString(data.due_date);
  const withholdingType = asString(data.withholding_type);
  const paymentStatus = asString(data.payment_status);

  if (
    !invoiceId ||
    amount === null ||
    withholdingAmount === null ||
    netAmount === null ||
    !issueDate ||
    !dueDate ||
    !withholdingTypes.includes(
      withholdingType as (typeof withholdingTypes)[number],
    ) ||
    !paymentStatuses.includes(paymentStatus as (typeof paymentStatuses)[number])
  ) {
    return null;
  }

  const contractTitle = asString(data.contract_title) ?? "(제목 없음)";

  return {
    state: "active",
    senderName: asString(data.sender_name),
    clientName: asString(data.client_name),
    contractTitle,
    dueDate,
    netAmount,
    paymentStatus: paymentStatus as Database["public"]["Enums"]["payment_status"],
    expiresAt: asString(data.expires_at),
    document: mapInvoicePdfProps({
      invoice: {
        id: invoiceId,
        amount,
        issue_date: issueDate,
        due_date: dueDate,
        withholding_type:
          withholdingType as Database["public"]["Enums"]["withholding_type"],
        withholding_amount: withholdingAmount,
        net_amount: netAmount,
        payment_status:
          paymentStatus as Database["public"]["Enums"]["payment_status"],
        paid_at: asString(data.paid_at),
      },
      clientName: asString(data.client_name),
      contractTitle,
      bankAccount: mapBankAccount({
        bank_name: asString(data.bank_name),
        bank_account_number: asString(data.bank_account_number),
        bank_account_holder: asString(data.bank_account_holder),
      }),
    }),
  };
}

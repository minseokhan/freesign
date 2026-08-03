import type { Database } from "@/types/database";

export const INVOICE_PDF_DISCLAIMER =
  "원천징수 계산은 참고용이며, 이 인보이스 PDF는 발행 시점에 저장된 금액 스냅샷을 그대로 표시합니다. 세무 신고 전 전문가 검토를 권장합니다.";

export type InvoicePdfBankAccount = {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
};

export type InvoicePdfDocument = {
  title: string;
  invoiceNumber: string;
  clientName: string;
  contractTitle: string;
  amountLabel: string;
  withholdingTypeLabel: string;
  withholdingAmountLabel: string;
  netAmountLabel: string;
  issueDateLabel: string;
  dueDateLabel: string;
  paymentStatusLabel: string;
  paidAtLabel: string | null;
  showWithholdingDetails: boolean;
  bankAccount: InvoicePdfBankAccount | null;
  disclaimer: string;
};

type InvoicePdfRow = Pick<
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
>;

type BankAccountFields = {
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
};

type MapInvoicePdfPropsInput = {
  invoice: InvoicePdfRow;
  clientName: string | null;
  contractTitle: string | null;
  bankAccount: InvoicePdfBankAccount | null;
};

const withholdingTypeLabels: Record<
  Database["public"]["Enums"]["withholding_type"],
  string
> = {
  wt_3_3: "3.3%",
  wt_8_8: "8.8%",
  none: "없음",
};

const paymentStatusLabels: Record<
  Database["public"]["Enums"]["payment_status"],
  string
> = {
  draft: "초안",
  unpaid: "미수",
  paid: "입금완료",
};

/**
 * 계좌 정보(snake_case 원본 필드)를 PDF 모델로 변환한다.
 * 소유자 라우트(profiles 조회)와 공개 토큰 라우트(get_invoice_view 반환값)가 공유한다.
 */
export function mapBankAccount(
  profile: BankAccountFields | null,
): InvoicePdfBankAccount | null {
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

export function mapInvoicePdfProps({
  invoice,
  clientName,
  contractTitle,
  bankAccount,
}: MapInvoicePdfPropsInput): InvoicePdfDocument {
  return {
    title: `인보이스 ${invoice.id}`,
    invoiceNumber: invoice.id,
    clientName: clientName ?? "클라이언트 없음",
    contractTitle: contractTitle ?? "계약 없음",
    amountLabel: formatCurrency(invoice.amount),
    withholdingTypeLabel: withholdingTypeLabels[invoice.withholding_type],
    withholdingAmountLabel: formatCurrency(invoice.withholding_amount),
    netAmountLabel: formatCurrency(invoice.net_amount),
    issueDateLabel: formatDate(invoice.issue_date),
    dueDateLabel: formatDate(invoice.due_date),
    paymentStatusLabel: paymentStatusLabels[invoice.payment_status],
    paidAtLabel: invoice.paid_at ? formatDateTime(invoice.paid_at) : null,
    showWithholdingDetails:
      invoice.withholding_type !== "none" || invoice.withholding_amount > 0,
    bankAccount,
    disclaimer: INVOICE_PDF_DISCLAIMER,
  };
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);

  if (!match) {
    return date;
  }

  const [, year, month, day] = match;

  return `${year}.${month}.${day}`;
}

function formatDateTime(date: string) {
  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(parsedDate)
    .replace("AM", "오전")
    .replace("PM", "오후");
}

import type { Json } from "@/types/database";

export const CONTRACT_PDF_DISCLAIMER =
  "이 문서는 FreeSign v1 간이 서명 기록용 PDF입니다. AI 초안은 법적 자문이 아니며, v1 간이 서명은 법적 효력을 보장하지 않습니다. 계약 확정 전 전문가 검토를 권장합니다.";

export type ContractPdfClause = {
  title: string;
  body: string;
  plainSummary: string;
  needsReview: boolean;
};

export type ContractPdfSignature = {
  signer: string;
  signedAtLabel: string;
  ip: string;
  ua: string;
};

export type ContractPdfModel = {
  title: string;
  clientName: string;
  scope: string;
  amountLabel: string;
  periodLabel: string;
  status: string;
  clauses: ContractPdfClause[];
  // 계약 전체 평문요약. 있으면 1회만 노출하고 조항별 요약은 생략한다(불러오기 계약은 null).
  plainSummary: string | null;
  docHash: string;
  signature: ContractPdfSignature | null;
  signatureImageDataUri: string | null;
  disclaimer: string;
};

type ContractPdfRow = {
  title: string;
  scope: string;
  amount: number;
  start_date: string;
  end_date: string;
  status: string;
  clauses: Json;
  plain_summary?: string | null;
  doc_hash: string | null;
  signature_meta: Json;
};

type MapContractPdfPropsInput = {
  contract: ContractPdfRow;
  clientName: string | null;
  signatureImageDataUri: string | null;
};

export function mapContractPdfProps({
  contract,
  clientName,
  signatureImageDataUri,
}: MapContractPdfPropsInput): ContractPdfModel {
  return {
    title: contract.title,
    clientName: clientName ?? "클라이언트 없음",
    scope: contract.scope,
    amountLabel: formatCurrency(contract.amount),
    periodLabel: `${formatDate(contract.start_date)} - ${formatDate(
      contract.end_date,
    )}`,
    status: contract.status,
    clauses: normalizeClauses(contract.clauses),
    plainSummary: normalizeContractSummary(contract.plain_summary),
    docHash: contract.doc_hash ?? "서명 전 문서 해시 없음",
    signature: normalizeSignature(contract.signature_meta),
    signatureImageDataUri,
    disclaimer: CONTRACT_PDF_DISCLAIMER,
  };
}

function normalizeContractSummary(summary: string | null | undefined): string | null {
  if (typeof summary !== "string") {
    return null;
  }

  const trimmed = summary.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function normalizeClauses(clauses: Json): ContractPdfClause[] {
  if (!Array.isArray(clauses)) {
    return [];
  }

  return clauses.filter(isClause).map((clause) => ({
    title: clause.title,
    body: clause.body,
    plainSummary: clause.plain_summary,
    needsReview: clause.needs_review === true,
  }));
}

function isClause(value: Json): value is {
  title: string;
  body: string;
  plain_summary: string;
  needs_review?: boolean;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    typeof value.plain_summary === "string"
  );
}

function normalizeSignature(signatureMeta: Json): ContractPdfSignature | null {
  if (!isSignatureMeta(signatureMeta)) {
    return null;
  }

  return {
    signer: signatureMeta.signer,
    signedAtLabel: formatDateTime(signatureMeta.signed_at),
    ip: signatureMeta.ip,
    ua: signatureMeta.ua,
  };
}

function isSignatureMeta(value: Json): value is {
  signer: string;
  signed_at: string;
  ip: string;
  ua: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.signer === "string" &&
    typeof value.signed_at === "string" &&
    typeof value.ip === "string" &&
    typeof value.ua === "string"
  );
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: string) {
  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");

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
  }).format(parsedDate);
}

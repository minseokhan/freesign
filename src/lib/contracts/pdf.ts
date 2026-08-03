import type { Json } from "@/types/database";

export const CONTRACT_PDF_DISCLAIMER =
  "이 문서는 매듭 전자서명 기록용 PDF입니다. AI 초안은 법적 자문이 아니며, 본 전자서명은 이메일 소유확인 수준으로 강한 법적 증거를 보장하지는 않습니다. 계약 확정 전 전문가 검토를 권장합니다.";

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

// 맞서명(v2) 상대방 서명 슬롯 — 이미지는 DB 저장 base64 data URI(ADR-009 예외).
// owner 블록과 대칭이 되도록 이메일·IP·User-Agent를 함께 담는다.
export type ContractPdfCounterpartySignature = {
  imageDataUri: string | null;
  name: string;
  email: string | null;
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
  // 상대방 서명이 있으면 owner 서명 아래에 함께 표기한다(없으면 기존 단독 레이아웃 불변).
  counterpartySignature?: ContractPdfCounterpartySignature | null;
  // 발주처 원본 PDF로 성사된 불러오기 계약. 원본이 증빙이므로 서식 PDF에는 서명 섹션을 넣지 않는다.
  isImported: boolean;
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
  source_pdf_url?: string | null;
};

export type CounterpartySignatureRow = {
  signer_name: string | null;
  signer_email: string | null;
  signed_at: string;
  signature_image_data: string | null;
  meta: Json | null;
};

/** contract_signatures.meta(jsonb)에서 ip/ua를 안전하게 읽는다. */
function parseCounterpartyMeta(meta: Json | null): { ip: string; ua: string } {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return { ip: "기록 없음", ua: "기록 없음" };
  }

  return {
    ip: typeof meta.ip === "string" ? meta.ip : "기록 없음",
    ua: typeof meta.ua === "string" ? meta.ua : "기록 없음",
  };
}

/** contract_signatures counterparty 행 → PDF 상대방 서명 슬롯. */
export function toCounterpartySignature(
  row: CounterpartySignatureRow | null,
): ContractPdfCounterpartySignature | null {
  if (!row) {
    return null;
  }

  const { ip, ua } = parseCounterpartyMeta(row.meta);

  return {
    imageDataUri: row.signature_image_data,
    name: row.signer_name ?? row.signer_email ?? "상대방",
    email: row.signer_email,
    signedAtLabel: formatDateTime(row.signed_at),
    ip,
    ua,
  };
}

type MapContractPdfPropsInput = {
  contract: ContractPdfRow;
  clientName: string | null;
  signatureImageDataUri: string | null;
  counterpartySignature?: ContractPdfCounterpartySignature | null;
};

export function mapContractPdfProps({
  contract,
  clientName,
  signatureImageDataUri,
  counterpartySignature = null,
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
    counterpartySignature,
    isImported: contract.source_pdf_url != null,
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

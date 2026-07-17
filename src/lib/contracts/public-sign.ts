// anon DEFINER RPC(get_signed_contract_data·get_certificate_data)의 jsonb 응답을
// 기존 PDF 렌더 입력으로 변환하는 순수 매핑. 공개 다운로드 라우트와
// 완료 이메일 첨부(step 8)가 공유한다. 형식이 어긋나면 null(렌더 스킵).
import {
  buildCertificateProps,
  type CertificateDocumentProps,
  type CertificateEventRow,
  type CertificateSignatureRow,
} from "@/lib/contracts/certificate";
import { mapContractPdfProps, type ContractPdfModel } from "@/lib/contracts/pdf";
import type { Json } from "@/types/database";

export type SignedContractData = {
  ownerUserId: string;
  clientName: string | null;
  contractId: string;
  contractTitle: string;
  docHash: string | null;
  model: ContractPdfModel;
};

type JsonObject = Record<string, Json | undefined>;

function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function formatDateTime(date: string): string {
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

/** get_signed_contract_data 응답 → 서명 완료 계약서 PDF 모델. */
export function parseSignedContractData(
  data: Json | null,
): SignedContractData | null {
  if (!isJsonObject(data)) {
    return null;
  }

  const contract = data.contract;
  const ownerUserId = asString(data.owner_user_id);

  if (!isJsonObject(contract) || !ownerUserId) {
    return null;
  }

  const id = asString(contract.id);
  const title = asString(contract.title);
  const scope = asString(contract.scope);
  const startDate = asString(contract.start_date);
  const endDate = asString(contract.end_date);
  const status = asString(contract.status);

  if (
    !id ||
    !title ||
    !scope ||
    !startDate ||
    !endDate ||
    !status ||
    typeof contract.amount !== "number"
  ) {
    return null;
  }

  const docHash = asString(contract.doc_hash);
  const owner = isJsonObject(data.owner_signature)
    ? data.owner_signature
    : null;
  const counterparty = isJsonObject(data.counterparty_signature)
    ? data.counterparty_signature
    : null;
  const counterpartySignature = counterparty
    ? {
        imageDataUri: asString(counterparty.signature_image_data),
        name:
          asString(counterparty.signer_name) ??
          asString(counterparty.signer_email) ??
          "상대방",
        email: asString(counterparty.signer_email),
        signedAtLabel: formatDateTime(asString(counterparty.signed_at) ?? ""),
        // 0023부터 get_signed_contract_data가 counterparty meta의 ip/ua를 평탄화해 내려준다.
        ip: asString(counterparty.ip) ?? "기록 없음",
        ua: asString(counterparty.ua) ?? "기록 없음",
      }
    : null;

  const model = mapContractPdfProps({
    contract: {
      title,
      scope,
      amount: contract.amount,
      start_date: startDate,
      end_date: endDate,
      status,
      clauses: contract.clauses ?? [],
      plain_summary: asString(contract.plain_summary),
      doc_hash: docHash,
      signature_meta: contract.signature_meta ?? null,
    },
    clientName: asString(data.client_name),
    // 0022부터 owner 서명 base64 사본이 owner_signature로 내려온다(구 계약은 null → 메타만 표기).
    signatureImageDataUri: owner ? asString(owner.signature_image_data) : null,
    counterpartySignature,
  });

  return {
    ownerUserId,
    clientName: asString(data.client_name),
    contractId: id,
    contractTitle: title,
    docHash,
    model,
  };
}

/** get_certificate_data 응답 → 완결증명서 props (미완결·형식 오류 시 null). */
export function parseCertificateData(
  data: Json | null,
  options: { tsaUrl?: string | null; generatedAt?: string } = {},
): CertificateDocumentProps | null {
  if (!isJsonObject(data)) {
    return null;
  }

  const contract = data.contract;

  if (!isJsonObject(contract)) {
    return null;
  }

  const id = asString(contract.id);
  const title = asString(contract.title);

  if (!id || !title) {
    return null;
  }

  const signatures = Array.isArray(data.signatures)
    ? data.signatures.filter(isSignatureRow)
    : [];
  const events = Array.isArray(data.events) ? data.events.filter(isEventRow) : [];
  const tsa = isJsonObject(data.tsa) ? data.tsa : null;
  const docHash = asString(contract.doc_hash);
  const counterpartyEmail =
    signatures.find((signature) => signature.party === "counterparty")
      ?.signer_email ?? null;

  return buildCertificateProps({
    // signature_meta는 owner 행 meta가 비어 있는 계약의 ip/ua 폴백(0022).
    contract: { id, title, doc_hash: docHash, signature_meta: contract.signature_meta ?? null },
    signatures,
    request: {
      recipient_email: counterpartyEmail ?? "",
      frozen_doc_hash: docHash ?? "",
      sent_tsa_token: tsa ? asString(tsa.sent_tsa_token) : null,
      completion_tsa_token: tsa ? asString(tsa.completion_tsa_token) : null,
      completed_at: asString(data.completed_at),
    },
    events,
    generatedAt: options.generatedAt,
    tsaUrl: options.tsaUrl ?? null,
  });
}

function isSignatureRow(value: Json): value is CertificateSignatureRow & Json {
  return (
    isJsonObject(value) &&
    typeof value.party === "string" &&
    typeof value.signed_at === "string"
  );
}

function isEventRow(value: Json): value is CertificateEventRow & Json {
  return (
    isJsonObject(value) &&
    typeof value.actor === "string" &&
    typeof value.to_status === "string" &&
    typeof value.event_type === "string" &&
    typeof value.created_at === "string"
  );
}

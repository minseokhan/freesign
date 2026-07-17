import { createHash } from "node:crypto";

import { contractEventLabel } from "@/lib/contracts/event-labels";
import type { Json } from "@/types/database";

// 과대표시 금지 — 이 증명서는 감사추적 요약이며 법적 판단을 대신하지 않는다.
export const CERTIFICATE_DISCLAIMER =
  "이 완결증명서는 FreeSign이 기록한 감사추적 요약입니다. 서명의 법적 효력·증거력에 대한 판단은 별도의 법률 검토가 필요하며, 이 문서가 법적 효력을 보장하지 않습니다.";

// 신원확인 수준을 정직하게 표기한다(휴대폰·신분증 인증 아님).
export const OWNER_IDENTITY_LEVEL = "서비스 로그인 계정 확인";
export const COUNTERPARTY_IDENTITY_LEVEL = "이메일 링크 소유 확인";

// TSA 토큰은 원문 보존·외부 검증 — 증명서엔 유무·지문·검증 안내만 담는다.
export const TSA_VERIFY_INSTRUCTION =
  "검증: 저장된 토큰 원문(base64)을 DER로 디코드한 뒤 `openssl ts -verify -in <token.der> -data <원문 파일> -CAfile <TSA CA 인증서>` 로 확인할 수 있습니다.";

const UNKNOWN_LABEL = "기록 없음";

const CONSENT_LABELS: Record<string, string> = {
  electronic_signature: "전자서명 사용 약정 동의",
  privacy: "개인정보 수집·이용 동의",
};

export type CertificateSignatureRow = {
  party: string;
  signer_name: string | null;
  signer_email: string | null;
  signed_at: string;
  consent: Json | null;
  meta: Json | null;
};

export type CertificateRequestRow = {
  recipient_email: string;
  frozen_doc_hash: string;
  sent_tsa_token: string | null;
  completion_tsa_token: string | null;
  completed_at: string | null;
};

export type CertificateEventRow = {
  actor: string;
  from_status: string | null;
  to_status: string;
  event_type: string;
  created_at: string;
};

export type CertificateContractRow = {
  id: string;
  title: string;
  doc_hash: string | null;
  signature_meta?: Json | null;
};

export type CertificateSignerBlock = {
  party: "owner" | "counterparty";
  partyLabel: string;
  name: string;
  email: string;
  signedAtLabel: string;
  ip: string;
  ua: string;
  consentLabels: string[];
  identityLevel: string;
};

export type CertificateTimelineItem = {
  label: string;
  actor: string;
  atLabel: string;
};

export type CertificateTsaEntry = {
  present: boolean;
  fingerprint: string | null;
};

export type CertificateDocumentProps = {
  contractTitle: string;
  contractId: string;
  generatedAtLabel: string;
  docHash: string;
  signers: CertificateSignerBlock[];
  timeline: CertificateTimelineItem[];
  tsa: {
    tsaUrl: string | null;
    sent: CertificateTsaEntry;
    completion: CertificateTsaEntry;
    verifyInstruction: string;
  };
  disclaimer: string;
};

type BuildCertificatePropsInput = {
  contract: CertificateContractRow;
  signatures: CertificateSignatureRow[];
  request: CertificateRequestRow | null;
  events: CertificateEventRow[];
  /** 생성 시각(ISO). 미지정 시 호출 시점. */
  generatedAt?: string;
  /** 스탬프에 사용한 TSA 엔드포인트(env TSA_URL). 미설정이면 null. */
  tsaUrl?: string | null;
};

/**
 * DB row → 완결증명서 document props 순수 매핑.
 * counterparty 서명이 없으면 미완결이므로 null을 반환한다.
 */
export function buildCertificateProps(
  input: BuildCertificatePropsInput,
): CertificateDocumentProps | null {
  const hasCounterparty = input.signatures.some(
    (signature) => signature.party === "counterparty",
  );

  if (!hasCounterparty) {
    return null;
  }

  const ownerFallbackMeta = parseIpUa(input.contract.signature_meta ?? null);
  const signers = [...input.signatures]
    .sort((a, b) => partyOrder(a.party) - partyOrder(b.party))
    .map((signature) => toSignerBlock(signature, ownerFallbackMeta));

  const timeline = [...input.events]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((event) => ({
      label: contractEventLabel(event.event_type),
      actor: event.actor,
      atLabel: formatDateTime(event.created_at),
    }));

  return {
    contractTitle: input.contract.title,
    contractId: input.contract.id,
    generatedAtLabel: formatDateTime(
      input.generatedAt ?? new Date().toISOString(),
    ),
    docHash:
      input.contract.doc_hash ?? input.request?.frozen_doc_hash ?? UNKNOWN_LABEL,
    signers,
    timeline,
    tsa: {
      tsaUrl: input.tsaUrl ?? null,
      sent: toTsaEntry(input.request?.sent_tsa_token ?? null),
      completion: toTsaEntry(input.request?.completion_tsa_token ?? null),
      verifyInstruction: TSA_VERIFY_INSTRUCTION,
    },
    disclaimer: CERTIFICATE_DISCLAIMER,
  };
}

function partyOrder(party: string): number {
  return party === "owner" ? 0 : 1;
}

function toSignerBlock(
  signature: CertificateSignatureRow,
  ownerFallbackMeta: { ip: string | null; ua: string | null },
): CertificateSignerBlock {
  const isOwner = signature.party === "owner";
  const meta = parseIpUa(signature.meta);
  const fallback = isOwner ? ownerFallbackMeta : { ip: null, ua: null };

  return {
    party: isOwner ? "owner" : "counterparty",
    partyLabel: isOwner ? "보낸 쪽(계약 소유자)" : "상대방",
    name: signature.signer_name ?? signature.signer_email ?? UNKNOWN_LABEL,
    email: signature.signer_email ?? UNKNOWN_LABEL,
    signedAtLabel: formatDateTime(signature.signed_at),
    ip: meta.ip ?? fallback.ip ?? UNKNOWN_LABEL,
    ua: meta.ua ?? fallback.ua ?? UNKNOWN_LABEL,
    consentLabels: parseConsentLabels(signature.consent),
    identityLevel: isOwner ? OWNER_IDENTITY_LEVEL : COUNTERPARTY_IDENTITY_LEVEL,
  };
}

function parseConsentLabels(consent: Json | null): string[] {
  if (typeof consent !== "object" || consent === null || Array.isArray(consent)) {
    return [];
  }

  return Object.entries(CONSENT_LABELS)
    .filter(([key]) => consent[key] === true)
    .map(([, label]) => label);
}

function parseIpUa(meta: Json | null): { ip: string | null; ua: string | null } {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return { ip: null, ua: null };
  }

  return {
    ip: typeof meta.ip === "string" ? meta.ip : null,
    ua: typeof meta.ua === "string" ? meta.ua : null,
  };
}

function toTsaEntry(token: string | null): CertificateTsaEntry {
  if (!token) {
    return { present: false, fingerprint: null };
  }

  const hex = createHash("sha256")
    .update(Buffer.from(token, "base64"))
    .digest("hex");

  return {
    present: true,
    fingerprint: `${hex.slice(0, 16)}…${hex.slice(-8)}`,
  };
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
    second: "2-digit",
  }).format(parsedDate);
}

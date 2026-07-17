// 계약 이벤트 타입 → 사용자용 한글 라벨.
// 상세 페이지 타임라인과 완결증명서(certificate.ts)가 공유한다.
export const CONTRACT_EVENT_LABELS: Record<string, string> = {
  "signature_request.sent": "서명 요청 발송",
  "signature_request.viewed": "상대방 열람",
  "signature_request.revoked": "서명 요청 철회",
  "contract.counterparty_signed": "상대방 서명(완결)",
  signed: "서명 완료",
  "contract.status_changed": "계약 상태 변경",
  "contract.imported": "기존 계약 불러오기(성사)",
};

export function contractEventLabel(eventType: string): string {
  return CONTRACT_EVENT_LABELS[eventType] ?? eventType;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** actor 원문(owner uuid·"counterparty:email")을 사용자용 표기로 변환. */
export function formatContractEventActor(actor: string): string {
  if (actor.startsWith("counterparty:")) {
    return `상대방(${actor.slice("counterparty:".length)})`;
  }

  if (UUID_PATTERN.test(actor)) {
    return "소유자";
  }

  return actor;
}

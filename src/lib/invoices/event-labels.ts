// 인보이스 이벤트 타입 → 사용자용 한글 라벨(상세 타임라인 표시용).
export const INVOICE_EVENT_LABELS: Record<string, string> = {
  "invoice.issued": "인보이스 발행",
  "invoice.payment_changed": "정산 상태 변경",
  "invoice.status_changed": "정산 상태 변경",
  "invoice.payment_marked": "입금 처리",
  "invoice.draft_generated": "반복 인보이스 초안 생성",
};

export function invoiceEventLabel(eventType: string): string {
  return INVOICE_EVENT_LABELS[eventType] ?? eventType;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** actor 원문(owner uuid·"cron:recurring")을 사용자용 표기로 변환. */
export function formatInvoiceEventActor(actor: string): string {
  if (actor.startsWith("cron:")) {
    return "자동 실행";
  }

  if (UUID_PATTERN.test(actor)) {
    return "소유자";
  }

  return actor;
}

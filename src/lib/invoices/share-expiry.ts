const DAY_MS = 86_400_000;

/** 지급기한 이후 링크가 살아 있어야 하는 기간 — 연체 독촉 구간을 덮는다. */
const DAYS_AFTER_DUE = 90;
/** 기한이 이미 지난 인보이스에도 최소한 이만큼은 열람 가능해야 한다. */
const MIN_DAYS = 30;
/** send_invoice_with_event가 거부하는 상한(400일)보다 안쪽이어야 한다. */
const MAX_DAYS = 365;

/**
 * 인보이스 공개 링크 만료 시각(ISO).
 *
 * 서명 토큰의 14일을 쓰지 않는 이유: 연체 독촉을 보내는 시점에 이미 만료돼 링크가 죽는다.
 * 반대로 무만료는 유출 시 영구 노출이므로, 지급기한 기준으로 잡고 상·하한을 둔다.
 */
export function computeInvoiceShareExpiry(
  dueDate: string,
  now: Date = new Date(),
): string {
  const floor = now.getTime() + MIN_DAYS * DAY_MS;
  const ceiling = now.getTime() + MAX_DAYS * DAY_MS;

  const due = Date.parse(dueDate);
  const fromDue = Number.isNaN(due) ? floor : due + DAYS_AFTER_DUE * DAY_MS;

  return new Date(Math.min(Math.max(fromDue, floor), ceiling)).toISOString();
}

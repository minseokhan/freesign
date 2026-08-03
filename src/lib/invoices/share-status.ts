// 인보이스 상세의 "청구서 발송 현황" 표시용 순수 매핑(0046).
//
// 원문 토큰을 저장하지 않으므로 발급된 링크를 화면에 다시 띄울 수는 없다. 대신 소유자가
// 실제로 알고 싶은 것 — 누구에게·언제 보냈는지, 상대가 열어봤는지, 메일이 실제로 나갔는지 —
// 를 보여준다. 이게 없으면 "링크를 다시 보려고" 재발송을 눌러 상대가 가진 링크를 죽이게 된다.

type ShareTokenRow = {
  recipient_email: string | null;
  last_sent_at: string | null;
  first_viewed_at: string | null;
  expires_at: string;
};

type EventRow = {
  event_type: string;
  created_at: string;
};

export type InvoiceShareStatus = {
  recipientEmail: string | null;
  sentAt: string | null;
  firstViewedAt: string | null;
  expiresAt: string;
  /** 현재 링크가 실제로 상대 메일함까지 갔는가(도달 이벤트 기준). */
  delivered: boolean;
};

/** 링크가 상대에게 도달했음을 뜻하는 이벤트 — 청구 안내 메일과 링크를 실은 독촉 메일. */
const DELIVERY_EVENTS = new Set(["invoice.sent", "invoice.dunning_sent"]);

export function deriveInvoiceShareStatus(
  token: ShareTokenRow | null,
  events: readonly EventRow[],
): InvoiceShareStatus | null {
  if (!token) {
    return null;
  }

  // 도달 판정은 "현재 링크의 발송 시각 이후"로 좁힌다. 재발송으로 토큰이 교체됐는데
  // 이번 메일이 실패한 경우, 예전 발송의 도달 기록을 현재 링크의 전달로 표시하면 거짓말이 된다.
  const sentAt = token.last_sent_at;
  const delivered = sentAt
    ? events.some(
        (event) =>
          DELIVERY_EVENTS.has(event.event_type) && event.created_at >= sentAt,
      )
    : false;

  return {
    recipientEmail: token.recipient_email,
    sentAt,
    firstViewedAt: token.first_viewed_at,
    expiresAt: token.expires_at,
    delivered,
  };
}

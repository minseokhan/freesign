// 순수 함수 이메일 템플릿: 사용자 입력(수신자명·계약 제목 등)이 html에 삽입되므로
// 모든 삽입값은 escapeHtml을 거친다(이메일 HTML 인젝션 방지).
import { formatKRW } from "@/lib/metrics";

export interface SignatureRequestEmailInput {
  recipientName: string | null;
  senderName: string;
  contractTitle: string;
  signUrl: string;
  expiresAt: string; // ISO
}

export interface CompletionEmailInput {
  contractTitle: string;
  docHash: string; // 전문(축약 금지) — 상대방 메일함이 영구 증거 사본이 되는 설계
  downloadUrl: string | null; // 첨부 실패 시 폴백 링크
  hasAttachments: boolean;
}

export interface DunningEmailInput {
  // 소유자가 승인·수정한 초안 본문을 그대로 발송한다(제목·본문은 이미 확정된 텍스트).
  subject: string;
  body: string;
  // 인보이스 공개 링크(0046). 토큰이 없는 과거 인보이스는 생략된다.
  invoiceUrl?: string;
}

export interface InvoiceIssuedEmailInput {
  clientName: string | null;
  senderName: string;
  contractTitle: string;
  amountNet: number; // 실수령 기준(원천징수 반영)
  dueDate: string; // ISO
  invoiceUrl: string;
  expiresAt: string; // ISO — 링크 만료
}

export interface OwnerDunningReviewEmailInput {
  reminderCount: number;
  reviewUrl: string;
}

export interface OwnerRecurringNoticeEmailInput {
  draftCount: number;
  reviewUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatKstDate(iso: string): string {
  const formatted = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

  // "2026. 07. 31." → "2026.07.31" (프로젝트 날짜 포맷 통일)
  return formatted.replaceAll(" ", "").replace(/\.$/, "");
}

export function renderSignatureRequestEmail(
  input: SignatureRequestEmailInput,
): RenderedEmail {
  const recipientLabel = input.recipientName ? `${input.recipientName}님` : "안녕하세요";
  const expiresOn = formatKstDate(input.expiresAt);
  const subject = `[FreeSign] ${input.senderName}님이 "${input.contractTitle}" 계약 서명을 요청했습니다`;

  const html = [
    `<p>${escapeHtml(recipientLabel)}, ${escapeHtml(input.senderName)}님이 계약서 서명을 요청했습니다.</p>`,
    `<p>계약 제목: <strong>${escapeHtml(input.contractTitle)}</strong></p>`,
    `<p><a href="${escapeHtml(input.signUrl)}">계약서 확인하고 서명하기</a></p>`,
    `<p>링크가 열리지 않으면 아래 주소를 브라우저에 붙여넣어 주세요.<br />${escapeHtml(input.signUrl)}</p>`,
    `<p>이 서명 링크는 <strong>${escapeHtml(expiresOn)}</strong>까지 유효합니다.</p>`,
    `<p style="color:#64748b;font-size:12px;">본 메일은 FreeSign 전자서명 요청 안내입니다. 요청에 동의하지 않으면 서명하지 않아도 됩니다.</p>`,
  ].join("\n");

  const text = [
    `${recipientLabel}, ${input.senderName}님이 계약서 서명을 요청했습니다.`,
    `계약 제목: ${input.contractTitle}`,
    `서명 링크: ${input.signUrl}`,
    `이 서명 링크는 ${expiresOn}까지 유효합니다.`,
    "본 메일은 FreeSign 전자서명 요청 안내입니다. 요청에 동의하지 않으면 서명하지 않아도 됩니다.",
  ].join("\n\n");

  return { subject, html, text };
}

// 클라이언트 발송용 독촉 메일. subject/body는 소유자가 앱에서 검토·승인·수정한 확정 텍스트를
// 받아 escape 후 문단 단위로 감싼다(줄바꿈 보존).
// 인보이스 링크는 승인된 본문을 건드리지 않고 뒤에 별도 문단으로 덧붙인다.
export function renderDunningEmail(input: DunningEmailInput): RenderedEmail {
  const bodyHtml = input.body
    .split("\n\n")
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br />")}</p>`)
    .join("\n");

  if (!input.invoiceUrl) {
    return { subject: input.subject, html: bodyHtml, text: input.body };
  }

  const html = [
    bodyHtml,
    `<p>청구 내역과 입금 계좌는 아래에서 확인하실 수 있습니다.<br /><a href="${escapeHtml(input.invoiceUrl)}">청구서 확인하기</a></p>`,
    `<p>링크가 열리지 않으면 아래 주소를 브라우저에 붙여넣어 주세요.<br />${escapeHtml(input.invoiceUrl)}</p>`,
  ].join("\n");

  const text = [
    input.body,
    `청구 내역·입금 계좌 확인: ${input.invoiceUrl}`,
  ].join("\n\n");

  return { subject: input.subject, html, text };
}

// 인보이스 발행 시 클라이언트에게 나가는 청구 안내. 금액·지급기한은 본문에 싣고,
// 계좌·PDF는 공개 링크(0046) 뒤에 둔다 — 메일 본문에 계좌를 반복하지 않는다.
export function renderInvoiceIssuedEmail(
  input: InvoiceIssuedEmailInput,
): RenderedEmail {
  const recipientLabel = input.clientName ? `${input.clientName}님` : "안녕하세요";
  const dueOn = formatKstDate(input.dueDate);
  const expiresOn = formatKstDate(input.expiresAt);
  const amount = formatKRW(input.amountNet);
  const subject = `[FreeSign] ${input.senderName}님이 "${input.contractTitle}" 대금을 청구했습니다`;

  const html = [
    `<p>${escapeHtml(recipientLabel)}, ${escapeHtml(input.senderName)}님이 청구서를 보냈습니다.</p>`,
    `<p>건명: <strong>${escapeHtml(input.contractTitle)}</strong><br />청구 금액(실수령 기준): <strong>${escapeHtml(amount)}</strong><br />지급기한: <strong>${escapeHtml(dueOn)}</strong></p>`,
    `<p><a href="${escapeHtml(input.invoiceUrl)}">청구서 확인하고 입금 계좌 보기</a></p>`,
    `<p>링크가 열리지 않으면 아래 주소를 브라우저에 붙여넣어 주세요.<br />${escapeHtml(input.invoiceUrl)}</p>`,
    `<p>이 청구서 링크는 <strong>${escapeHtml(expiresOn)}</strong>까지 유효합니다.</p>`,
    `<p style="color:#64748b;font-size:12px;">본 메일은 FreeSign 청구 안내입니다.</p>`,
  ].join("\n");

  const text = [
    `${recipientLabel}, ${input.senderName}님이 청구서를 보냈습니다.`,
    `건명: ${input.contractTitle}`,
    `청구 금액(실수령 기준): ${amount}`,
    `지급기한: ${dueOn}`,
    `청구서 확인·입금 계좌: ${input.invoiceUrl}`,
    `이 청구서 링크는 ${expiresOn}까지 유효합니다.`,
    "본 메일은 FreeSign 청구 안내입니다.",
  ].join("\n\n");

  return { subject, html, text };
}

// 소유자(프리랜서)에게 "검토 대기 독촉 N건" 알림. 클라이언트가 아닌 본인에게만 발송.
export function renderOwnerDunningReviewEmail(
  input: OwnerDunningReviewEmailInput,
): RenderedEmail {
  const subject = `[FreeSign] 검토 대기 중인 미수금 독촉 초안 ${input.reminderCount}건`;

  const html = [
    `<p>연체 인보이스에 대한 독촉 메일 초안 <strong>${input.reminderCount}건</strong>이 자동 생성되었습니다.</p>`,
    "<p>초안은 자동 발송되지 않습니다. 앱에서 내용을 검토·수정한 뒤 승인해야 클라이언트에게 발송됩니다.</p>",
    `<p><a href="${escapeHtml(input.reviewUrl)}">검토 대기 독촉 보러 가기</a></p>`,
    `<p style="color:#64748b;font-size:12px;">본 메일은 FreeSign 미수금 자동 독촉 안내입니다.</p>`,
  ].join("\n");

  const text = [
    `연체 인보이스에 대한 독촉 메일 초안 ${input.reminderCount}건이 자동 생성되었습니다.`,
    "초안은 자동 발송되지 않습니다. 앱에서 검토·수정 후 승인해야 클라이언트에게 발송됩니다.",
    `검토하러 가기: ${input.reviewUrl}`,
    "본 메일은 FreeSign 미수금 자동 독촉 안내입니다.",
  ].join("\n\n");

  return { subject, html, text };
}

// 소유자에게 "검토 대기 반복 인보이스 초안 N건" 알림. 크론은 draft만 만들고 발행하지 않는다.
export function renderOwnerRecurringNoticeEmail(
  input: OwnerRecurringNoticeEmailInput,
): RenderedEmail {
  const subject = `[FreeSign] 검토 대기 중인 반복 인보이스 초안 ${input.draftCount}건`;

  const html = [
    `<p>반복 인보이스 초안 <strong>${input.draftCount}건</strong>이 자동 생성되었습니다.</p>`,
    "<p>초안은 자동 발행되지 않습니다. 앱에서 내용을 확인한 뒤 발행해야 청구가 시작됩니다.</p>",
    `<p><a href="${escapeHtml(input.reviewUrl)}">인보이스 초안 보러 가기</a></p>`,
    `<p style="color:#64748b;font-size:12px;">본 메일은 FreeSign 반복 인보이스 안내입니다.</p>`,
  ].join("\n");

  const text = [
    `반복 인보이스 초안 ${input.draftCount}건이 자동 생성되었습니다.`,
    "초안은 자동 발행되지 않습니다. 앱에서 확인 후 발행해야 청구가 시작됩니다.",
    `확인하러 가기: ${input.reviewUrl}`,
    "본 메일은 FreeSign 반복 인보이스 안내입니다.",
  ].join("\n\n");

  return { subject, html, text };
}

export function renderCompletionEmail(input: CompletionEmailInput): RenderedEmail {
  const subject = `[FreeSign] "${input.contractTitle}" 계약 서명이 완료되었습니다`;

  const deliveryHtml = input.hasAttachments
    ? "<p>서명 완료된 계약서 PDF와 완결증명서 PDF를 이 메일에 첨부했습니다. 영구 보관용 사본으로 보관해 주세요.</p>"
    : input.downloadUrl
      ? `<p>서명 완료된 계약서와 완결증명서는 아래 링크에서 내려받을 수 있습니다.<br /><a href="${escapeHtml(input.downloadUrl)}">${escapeHtml(input.downloadUrl)}</a></p>`
      : "";

  const deliveryText = input.hasAttachments
    ? "서명 완료된 계약서 PDF와 완결증명서 PDF를 이 메일에 첨부했습니다. 영구 보관용 사본으로 보관해 주세요."
    : input.downloadUrl
      ? `서명 완료된 계약서와 완결증명서 다운로드: ${input.downloadUrl}`
      : "";

  const html = [
    `<p>"${escapeHtml(input.contractTitle)}" 계약의 양 당사자 서명이 완료되었습니다.</p>`,
    deliveryHtml,
    "<p>문서 지문(SHA-256, 전문):</p>",
    `<p style="font-family:monospace;word-break:break-all;">${escapeHtml(input.docHash)}</p>`,
    `<p style="color:#64748b;font-size:12px;">위 해시는 서명 시점 계약 내용의 무결성 확인용입니다. 이 메일을 보관하면 계약 내용 위·변조 여부를 대조할 수 있습니다.</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `"${input.contractTitle}" 계약의 양 당사자 서명이 완료되었습니다.`,
    deliveryText,
    `문서 지문(SHA-256, 전문): ${input.docHash}`,
    "위 해시는 서명 시점 계약 내용의 무결성 확인용입니다. 이 메일을 보관하면 계약 내용 위·변조 여부를 대조할 수 있습니다.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject, html, text };
}

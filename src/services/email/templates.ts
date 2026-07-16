// 순수 함수 이메일 템플릿: 사용자 입력(수신자명·계약 제목 등)이 html에 삽입되므로
// 모든 삽입값은 escapeHtml을 거친다(이메일 HTML 인젝션 방지).

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

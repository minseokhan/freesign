import { describe, expect, it } from "vitest";

import {
  renderCompletionEmail,
  renderDunningEmail,
  renderInvoiceIssuedEmail,
  renderOwnerDunningReviewEmail,
  renderOwnerRecurringNoticeEmail,
  renderSignatureRequestEmail,
} from "@/services/email/templates";

describe("renderSignatureRequestEmail", () => {
  const baseInput = {
    recipientName: "김담당",
    senderName: "한프리",
    contractTitle: "브랜드 리뉴얼 용역",
    signUrl: "https://maedeup.example/sign/token-abc",
    expiresAt: "2026-07-31T00:00:00.000Z",
  };

  it("includes the sign URL in both html and text", () => {
    const rendered = renderSignatureRequestEmail(baseInput);

    expect(rendered.html).toContain(baseInput.signUrl);
    expect(rendered.text).toContain(baseInput.signUrl);
  });

  it("includes the expiry date (KST) in both html and text", () => {
    const rendered = renderSignatureRequestEmail(baseInput);

    expect(rendered.html).toContain("2026.07.31");
    expect(rendered.text).toContain("2026.07.31");
  });

  it("includes recipient and sender names and the contract title", () => {
    const rendered = renderSignatureRequestEmail(baseInput);

    expect(rendered.subject).toContain(baseInput.contractTitle);
    expect(rendered.html).toContain("김담당");
    expect(rendered.html).toContain("한프리");
    expect(rendered.text).toContain(baseInput.contractTitle);
  });

  it("falls back gracefully when recipientName is null", () => {
    const rendered = renderSignatureRequestEmail({
      ...baseInput,
      recipientName: null,
    });

    expect(rendered.html).toContain(baseInput.signUrl);
    expect(rendered.html).not.toContain("null");
    expect(rendered.text).not.toContain("null");
  });

  it("escapes html in user-supplied values", () => {
    const rendered = renderSignatureRequestEmail({
      ...baseInput,
      recipientName: '<img src=x onerror="x">',
      senderName: "<b>발신자</b>",
      contractTitle: '<script>alert("xss")</script>',
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).not.toContain("<b>발신자</b>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });
});

describe("renderCompletionEmail", () => {
  const docHash =
    "3f9a1b2c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6ec21";

  it("includes the full doc hash (no truncation) in html and text", () => {
    const rendered = renderCompletionEmail({
      contractTitle: "브랜드 리뉴얼 용역",
      docHash,
      downloadUrl: null,
      hasAttachments: true,
    });

    expect(rendered.html).toContain(docHash);
    expect(rendered.text).toContain(docHash);
  });

  it("mentions attachments when hasAttachments is true", () => {
    const rendered = renderCompletionEmail({
      contractTitle: "브랜드 리뉴얼 용역",
      docHash,
      downloadUrl: null,
      hasAttachments: true,
    });

    expect(rendered.html).toContain("첨부");
    expect(rendered.text).toContain("첨부");
  });

  it("includes the fallback download link when attachments are missing", () => {
    const downloadUrl = "https://maedeup.example/sign/token-abc";
    const rendered = renderCompletionEmail({
      contractTitle: "브랜드 리뉴얼 용역",
      docHash,
      downloadUrl,
      hasAttachments: false,
    });

    expect(rendered.html).toContain(downloadUrl);
    expect(rendered.text).toContain(downloadUrl);
  });

  it("escapes html in the contract title", () => {
    const rendered = renderCompletionEmail({
      contractTitle: '<script>alert("xss")</script>',
      docHash,
      downloadUrl: null,
      hasAttachments: true,
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });
});

describe("renderDunningEmail", () => {
  it("소유자 확정 제목·본문을 그대로 싣고 문단을 <p>로 감싼다", () => {
    const rendered = renderDunningEmail({
      subject: "[안내] 대금 지급",
      body: "안녕하세요.\n\n지급 부탁드립니다.",
    });

    expect(rendered.subject).toBe("[안내] 대금 지급");
    expect(rendered.text).toContain("지급 부탁드립니다.");
    expect(rendered.html).toContain("<p>안녕하세요.</p>");
    expect(rendered.html).toContain("<p>지급 부탁드립니다.</p>");
  });

  it("본문에 든 html을 escape한다", () => {
    const rendered = renderDunningEmail({
      subject: "s",
      body: '<script>alert("xss")</script>',
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });

  it("단일 줄바꿈은 <br />로 보존한다", () => {
    const rendered = renderDunningEmail({ subject: "s", body: "1줄\n2줄" });
    expect(rendered.html).toContain("1줄<br />2줄");
  });

  it("invoiceUrl이 있으면 본문을 건드리지 않고 링크 문단을 덧붙인다", () => {
    const rendered = renderDunningEmail({
      subject: "s",
      body: "지급 부탁드립니다.",
      invoiceUrl: "https://maedeup.example/invoice/tok-1",
    });

    expect(rendered.html).toContain("<p>지급 부탁드립니다.</p>");
    expect(rendered.html).toContain("https://maedeup.example/invoice/tok-1");
    expect(rendered.text).toContain("https://maedeup.example/invoice/tok-1");
  });

  it("invoiceUrl이 없으면 링크 문단을 넣지 않는다", () => {
    const rendered = renderDunningEmail({ subject: "s", body: "지급 부탁드립니다." });

    expect(rendered.html).not.toContain("<a href");
    expect(rendered.text.trim()).toBe("지급 부탁드립니다.");
  });
});

describe("renderInvoiceIssuedEmail", () => {
  const baseInput = {
    clientName: "Acme 스튜디오",
    senderName: "한프리",
    contractTitle: "브랜드 리뉴얼 용역",
    amountNet: 967000,
    dueDate: "2026-08-31T00:00:00.000Z",
    invoiceUrl: "https://maedeup.example/invoice/token-abc",
    expiresAt: "2026-11-29T00:00:00.000Z",
  };

  it("금액·지급기한·링크를 html과 text 모두에 싣는다", () => {
    const rendered = renderInvoiceIssuedEmail(baseInput);

    expect(rendered.subject).toContain(baseInput.contractTitle);
    expect(rendered.html).toContain("₩967,000");
    expect(rendered.html).toContain("2026.08.31");
    expect(rendered.html).toContain(baseInput.invoiceUrl);
    expect(rendered.text).toContain("₩967,000");
    expect(rendered.text).toContain("2026.08.31");
    expect(rendered.text).toContain(baseInput.invoiceUrl);
  });

  it("링크 만료일을 안내한다", () => {
    const rendered = renderInvoiceIssuedEmail(baseInput);

    expect(rendered.html).toContain("2026.11.29");
    expect(rendered.text).toContain("2026.11.29");
  });

  it("clientName이 null이어도 'null'을 노출하지 않는다", () => {
    const rendered = renderInvoiceIssuedEmail({ ...baseInput, clientName: null });

    expect(rendered.html).not.toContain("null");
    expect(rendered.html).toContain(baseInput.invoiceUrl);
  });

  it("사용자 입력값의 html을 escape한다", () => {
    const rendered = renderInvoiceIssuedEmail({
      ...baseInput,
      clientName: '<script>alert("xss")</script>',
      contractTitle: "<b>제목</b>",
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).not.toContain("<b>제목</b>");
  });
});

describe("renderOwnerDunningReviewEmail", () => {
  it("검토 건수와 링크를 포함한다", () => {
    const rendered = renderOwnerDunningReviewEmail({
      reminderCount: 3,
      reviewUrl: "https://maedeup.example/invoices",
    });

    expect(rendered.subject).toContain("3건");
    expect(rendered.html).toContain("https://maedeup.example/invoices");
    expect(rendered.text).toContain("https://maedeup.example/invoices");
  });
});

describe("renderOwnerRecurringNoticeEmail", () => {
  it("초안 건수와 링크를 포함한다", () => {
    const rendered = renderOwnerRecurringNoticeEmail({
      draftCount: 2,
      reviewUrl: "https://maedeup.example/invoices/recurring",
    });

    expect(rendered.subject).toContain("2건");
    expect(rendered.html).toContain("https://maedeup.example/invoices/recurring");
    expect(rendered.text).toContain("https://maedeup.example/invoices/recurring");
  });
});

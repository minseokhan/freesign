import { describe, expect, it } from "vitest";

import {
  renderCompletionEmail,
  renderDunningEmail,
  renderOwnerDunningReviewEmail,
  renderOwnerRecurringNoticeEmail,
  renderSignatureRequestEmail,
} from "@/services/email/templates";

describe("renderSignatureRequestEmail", () => {
  const baseInput = {
    recipientName: "김담당",
    senderName: "한프리",
    contractTitle: "브랜드 리뉴얼 용역",
    signUrl: "https://freesign.example/sign/token-abc",
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
    const downloadUrl = "https://freesign.example/sign/token-abc";
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
});

describe("renderOwnerDunningReviewEmail", () => {
  it("검토 건수와 링크를 포함한다", () => {
    const rendered = renderOwnerDunningReviewEmail({
      reminderCount: 3,
      reviewUrl: "https://freesign.example/invoices",
    });

    expect(rendered.subject).toContain("3건");
    expect(rendered.html).toContain("https://freesign.example/invoices");
    expect(rendered.text).toContain("https://freesign.example/invoices");
  });
});

describe("renderOwnerRecurringNoticeEmail", () => {
  it("초안 건수와 링크를 포함한다", () => {
    const rendered = renderOwnerRecurringNoticeEmail({
      draftCount: 2,
      reviewUrl: "https://freesign.example/invoices/recurring",
    });

    expect(rendered.subject).toContain("2건");
    expect(rendered.html).toContain("https://freesign.example/invoices/recurring");
    expect(rendered.text).toContain("https://freesign.example/invoices/recurring");
  });
});

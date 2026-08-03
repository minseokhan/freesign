import { renderToBuffer } from "@react-pdf/renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvoiceDocument } from "@/components/pdf/invoice-document";
import type { InvoicePdfDocument } from "@/lib/invoices/pdf";
import { renderInvoicePdf } from "@/lib/invoices/render-pdf";

vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: vi.fn(),
}));

vi.mock("@/components/pdf/invoice-document", () => ({
  InvoiceDocument: vi.fn(() => null),
}));

describe("render-pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(renderToBuffer).mockResolvedValue(Buffer.from("%PDF-1.7"));
  });

  it("renders the invoice document into a PDF buffer", async () => {
    const model = { title: "인보이스" } as InvoicePdfDocument;

    const buffer = await renderInvoicePdf(model);

    expect(buffer).toEqual(Buffer.from("%PDF-1.7"));
    expect(renderToBuffer).toHaveBeenCalledTimes(1);
    const element = vi.mocked(renderToBuffer).mock.calls[0][0] as unknown as {
      type: unknown;
      props: unknown;
    };
    expect(element.type).toBe(InvoiceDocument);
    expect(element.props).toEqual({ document: model });
  });
});

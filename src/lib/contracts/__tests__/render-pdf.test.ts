import { renderToBuffer } from "@react-pdf/renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CertificateDocument } from "@/components/pdf/certificate-document";
import { ContractDocument } from "@/components/pdf/contract-document";
import type { CertificateDocumentProps } from "@/lib/contracts/certificate";
import type { ContractPdfModel } from "@/lib/contracts/pdf";
import { renderCertificatePdf, renderContractPdf } from "@/lib/contracts/render-pdf";

vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: vi.fn(),
}));

vi.mock("@/components/pdf/contract-document", () => ({
  ContractDocument: vi.fn(() => null),
}));

vi.mock("@/components/pdf/certificate-document", () => ({
  CertificateDocument: vi.fn(() => null),
}));

describe("render-pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(renderToBuffer).mockResolvedValue(Buffer.from("%PDF-1.7"));
  });

  it("renders the contract document into a PDF buffer", async () => {
    const model = { title: "계약" } as ContractPdfModel;

    const buffer = await renderContractPdf(model);

    expect(buffer).toEqual(Buffer.from("%PDF-1.7"));
    expect(renderToBuffer).toHaveBeenCalledTimes(1);
    const element = vi.mocked(renderToBuffer).mock.calls[0][0] as unknown as {
      type: unknown;
      props: unknown;
    };
    expect(element.type).toBe(ContractDocument);
    expect(element.props).toEqual({ document: model });
  });

  it("renders the certificate document into a PDF buffer", async () => {
    const certificate = { contractId: "c-1" } as CertificateDocumentProps;

    const buffer = await renderCertificatePdf(certificate);

    expect(buffer).toEqual(Buffer.from("%PDF-1.7"));
    const element = vi.mocked(renderToBuffer).mock.calls[0][0] as unknown as {
      type: unknown;
      props: unknown;
    };
    expect(element.type).toBe(CertificateDocument);
    expect(element.props).toEqual({ certificate });
  });
});

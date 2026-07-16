// server-only: @react-pdf/renderer는 Node 런타임 전용(폰트 파일 접근) —
// 클라이언트 컴포넌트에서 import하지 말 것. 라우트 핸들러(runtime='nodejs')에서만 사용한다.
import { createElement } from "react";

import { renderToBuffer } from "@react-pdf/renderer";

import { CertificateDocument } from "@/components/pdf/certificate-document";
import { ContractDocument } from "@/components/pdf/contract-document";
import type { CertificateDocumentProps } from "@/lib/contracts/certificate";
import type { ContractPdfModel } from "@/lib/contracts/pdf";

/** 계약서 PDF 렌더 — 기존 pdf route와 step 8 완료 이메일 첨부가 공유한다. */
export async function renderContractPdf(
  document: ContractPdfModel,
): Promise<Buffer> {
  const element = createElement(ContractDocument, {
    document,
  }) as Parameters<typeof renderToBuffer>[0];

  return renderToBuffer(element);
}

/** 완결증명서 PDF 렌더 — owner certificate route와 step 8 첨부가 공유한다. */
export async function renderCertificatePdf(
  certificate: CertificateDocumentProps,
): Promise<Buffer> {
  const element = createElement(CertificateDocument, {
    certificate,
  }) as Parameters<typeof renderToBuffer>[0];

  return renderToBuffer(element);
}

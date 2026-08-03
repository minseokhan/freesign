// server-only: @react-pdf/renderer는 Node 런타임 전용(폰트 파일 접근) —
// 클라이언트 컴포넌트에서 import하지 말 것. 라우트 핸들러(runtime='nodejs')에서만 사용한다.
import { createElement } from "react";

import { renderToBuffer } from "@react-pdf/renderer";

import { InvoiceDocument } from "@/components/pdf/invoice-document";
import type { InvoicePdfDocument } from "@/lib/invoices/pdf";

/** 인보이스 PDF 렌더 — 소유자 라우트와 공개 토큰 라우트(0046)가 공유한다. */
export async function renderInvoicePdf(
  document: InvoicePdfDocument,
): Promise<Buffer> {
  const element = createElement(InvoiceDocument, {
    document,
  }) as Parameters<typeof renderToBuffer>[0];

  return renderToBuffer(element);
}

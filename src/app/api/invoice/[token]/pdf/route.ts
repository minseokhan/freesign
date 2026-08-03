import { NextResponse } from "next/server";

import { parseInvoiceView } from "@/lib/invoices/public-view";
import { renderInvoicePdf } from "@/lib/invoices/render-pdf";
import { captureServerException } from "@/lib/posthog-server";
import { getRequestIpHash } from "@/lib/request-meta";
import { hashSigningToken } from "@/lib/signing-token";
import { createAnonClient } from "@/lib/supabase/anon";

export const runtime = "nodejs";
export const maxDuration = 30;

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

// 클라이언트 보관용 청구서 PDF — 활성·미만료 토큰만 응답한다.
// 소유자 라우트(/api/invoices/[id]/pdf)와 같은 렌더러를 쓰므로 두 사본의 문서번호·내용이 같다.
export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;

  if (!token?.trim()) {
    return NextResponse.json(
      { error: "청구서를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const supabase = createAnonClient();
  const { data: allowed, error: rateError } = await supabase.rpc(
    "consume_anon_rate_limit",
    {
      p_ip_hash: getRequestIpHash(request),
      p_bucket: "invoice_pdf",
      p_limit: 10,
      p_window_seconds: 60,
    },
  );

  if (rateError) {
    await captureServerException(rateError, undefined, {
      route: "invoice/token/pdf",
    });
    return NextResponse.json(
      { error: "요청 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }

  if (allowed !== true) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );
  }

  const { data, error } = await supabase.rpc("get_invoice_view", {
    p_token_hash: hashSigningToken(token),
  });

  if (error) {
    await captureServerException(error, undefined, {
      route: "invoice/token/pdf",
    });
    return NextResponse.json(
      { error: "요청 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }

  const view = parseInvoiceView(data);

  if (view?.state !== "active") {
    return NextResponse.json(
      { error: "유효한 청구서 링크가 아닙니다." },
      { status: 404 },
    );
  }

  const pdfBuffer = await renderInvoicePdf(view.document);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="invoice-${view.document.invoiceNumber}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}

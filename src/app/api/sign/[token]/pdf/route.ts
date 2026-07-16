import { NextResponse } from "next/server";

import { parseSignedContractData } from "@/lib/contracts/public-sign";
import { renderContractPdf } from "@/lib/contracts/render-pdf";
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

// 상대방 교부용 서명 완료 계약서 PDF(상대 서명 슬롯 포함) — completed 토큰만 응답한다.
export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;

  if (!token?.trim()) {
    return NextResponse.json(
      { error: "서명 요청을 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const supabase = createAnonClient();
  const { data: allowed, error: rateError } = await supabase.rpc(
    "consume_anon_rate_limit",
    {
      p_ip_hash: getRequestIpHash(request),
      p_bucket: "certificate_download",
      p_limit: 10,
      p_window_seconds: 60,
    },
  );

  if (rateError) {
    await captureServerException(rateError, undefined, {
      route: "sign/token/pdf",
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

  const { data, error } = await supabase.rpc("get_signed_contract_data", {
    p_token_hash: hashSigningToken(token),
  });

  if (error) {
    await captureServerException(error, undefined, { route: "sign/token/pdf" });
    return NextResponse.json(
      { error: "요청 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }

  const signedData = parseSignedContractData(data);

  if (!signedData) {
    return NextResponse.json(
      { error: "완결된 서명 요청만 계약서를 내려받을 수 있습니다." },
      { status: 404 },
    );
  }

  const pdfBuffer = await renderContractPdf(signedData.model);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="contract-${signedData.contractId}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}

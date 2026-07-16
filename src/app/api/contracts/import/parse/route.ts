import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import {
  captureServerException,
  getPostHogClient,
} from "@/lib/posthog-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { extractContractFromPdf } from "@/services/ai/contract-import";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await requireUser();

  const limit = await checkRateLimit(RATE_LIMITS.aiPdfParse);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "PDF 파일을 업로드해 주세요." },
        { status: 400 },
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "PDF 파일만 업로드할 수 있습니다." },
        { status: 415 },
      );
    }

    if (file.size > MAX_PDF_SIZE_BYTES) {
      return NextResponse.json(
        { error: "5MB 이하 PDF만 업로드할 수 있습니다." },
        { status: 413 },
      );
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const extracted = await extractContractFromPdf(base64);

    // source(ai|fallback)로 파싱 품질을 관측한다. 이후 contract_imported와 퍼널 연결.
    const posthog = getPostHogClient();
    posthog.capture({ distinctId: user.id, event: "contract_pdf_parsed", properties: { source: extracted.source } });
    await posthog.flush();

    return NextResponse.json({ extracted });
  } catch (error) {
    await captureServerException(error, user.id, {
      route: "contracts/import/parse",
    });

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "계약서 PDF를 분석하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

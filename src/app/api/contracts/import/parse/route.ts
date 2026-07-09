import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { extractContractFromPdf } from "@/services/ai/contract-import";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  await requireUser();

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

    return NextResponse.json({ extracted });
  } catch (error) {
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

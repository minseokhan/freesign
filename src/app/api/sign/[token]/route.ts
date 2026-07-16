import { NextResponse } from "next/server";
import { z } from "zod";

import {
  parseCertificateData,
  parseSignedContractData,
  type SignedContractData,
} from "@/lib/contracts/public-sign";
import {
  renderCertificatePdf,
  renderContractPdf,
} from "@/lib/contracts/render-pdf";
import { getTimestampEnv } from "@/lib/env";
import {
  captureServerException,
  getPostHogClient,
} from "@/lib/posthog-server";
import {
  getRequestIp,
  getRequestIpHash,
  getRequestUserAgent,
} from "@/lib/request-meta";
import { resolveSiteUrl } from "@/lib/seo";
import { computeCompletionDigest } from "@/lib/signing-digest";
import { hashSigningToken } from "@/lib/signing-token";
import { createAnonClient } from "@/lib/supabase/anon";
import {
  getEmailProvider,
  type EmailAttachment,
} from "@/services/email/provider";
import { renderCompletionEmail } from "@/services/email/templates";
import { getTimestampProvider } from "@/services/timestamp/provider";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 30;

// 캔버스 PNG는 ~30KB — 200KB 상한(문자 수 기준, DB CHECK 256KB보다 보수적).
const MAX_SIGNATURE_DATA_URL_LENGTH = 204_800;
const PNG_DATA_URL_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

// client 입력 전용 allowlist — 토큰 외 서버 소유 필드는 받지 않는다.
const signBodySchema = z.object({
  signerName: z.string().trim().min(1).max(120),
  signatureDataUrl: z
    .string()
    .max(MAX_SIGNATURE_DATA_URL_LENGTH)
    .regex(PNG_DATA_URL_PATTERN, "PNG 서명 데이터가 필요합니다."),
  consentElectronicSignature: z.literal(true),
  consentPrivacy: z.literal(true),
});

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

type CompletionResult = {
  contractId: string;
  contractTitle: string;
  ownerEmail: string | null;
  recipientEmail: string | null;
};

/** complete RPC의 jsonb 반환(완료 알림용 최소 필드)을 읽는다. */
function readCompletionResult(data: Json | null): CompletionResult | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }

  const contractId =
    typeof data.contract_id === "string" ? data.contract_id : null;

  if (!contractId) {
    return null;
  }

  return {
    contractId,
    contractTitle:
      typeof data.contract_title === "string" ? data.contract_title : "계약",
    ownerEmail: typeof data.owner_email === "string" ? data.owner_email : null,
    recipientEmail:
      typeof data.recipient_email === "string" ? data.recipient_email : null,
  };
}

/** 0019 RPC raise 메시지 → HTTP 상태·한국어 안내 매핑. */
function mapCompleteError(message: string): { status: number; error: string } {
  if (message.includes("already completed")) {
    return { status: 409, error: "이미 서명이 완료된 요청입니다." };
  }

  if (message.includes("hash mismatch") || message.includes("not awaiting")) {
    return {
      status: 409,
      error:
        "계약 내용이 변경되어 서명할 수 없습니다. 보낸 분에게 재요청을 부탁해 주세요.",
    };
  }

  if (message.includes("expired")) {
    return {
      status: 410,
      error: "서명 링크가 만료되었습니다. 보낸 분에게 재발송을 요청해 주세요.",
    };
  }

  if (message.includes("revoked")) {
    return { status: 410, error: "서명 요청이 철회되었습니다." };
  }

  if (message.includes("not found")) {
    return { status: 404, error: "서명 요청을 찾을 수 없습니다." };
  }

  if (message.includes("invalid")) {
    return { status: 400, error: "서명 데이터를 확인해 주세요." };
  }

  return { status: 500, error: "서명 처리 중 오류가 발생했습니다." };
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;

  if (!token?.trim()) {
    return NextResponse.json(
      { error: "서명 요청을 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const supabase = createAnonClient();

  // 1) anon 레이트리밋 — 원본 IP 대신 sha256 해시만 넘긴다.
  const { data: allowed, error: rateError } = await supabase.rpc(
    "consume_anon_rate_limit",
    {
      p_ip_hash: getRequestIpHash(request),
      p_bucket: "counterparty_sign",
      p_limit: 5,
      p_window_seconds: 60,
    },
  );

  if (rateError) {
    await captureServerException(rateError, undefined, { route: "sign/token" });
    return NextResponse.json(
      { error: "서명 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }

  if (allowed !== true) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );
  }

  // 2) zod allowlist
  const body = await request.json().catch(() => null);
  const parsed = signBodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "서명 데이터를 확인해 주세요." },
      { status: 400 },
    );
  }

  // 3) 완결 RPC 단일 호출 — 사전 검증 SELECT 없음(검증·INSERT·전이가 RPC 트랜잭션 내부, TOCTOU 제거).
  const tokenHash = hashSigningToken(token);
  const consentedAt = new Date().toISOString();
  const { data: completeData, error: completeError } = await supabase.rpc(
    "complete_counterparty_signature_with_event",
    {
      p_token_hash: tokenHash,
      p_signature_image_data: parsed.data.signatureDataUrl,
      p_signer_name: parsed.data.signerName,
      p_consent: {
        electronic_signature: true,
        privacy: true,
        consented_at: consentedAt,
      },
      p_ip: getRequestIp(request),
      p_ua: getRequestUserAgent(request),
    },
  );

  if (completeError) {
    const mapped = mapCompleteError(completeError.message);

    if (mapped.status === 500) {
      await captureServerException(completeError, undefined, {
        route: "sign/token",
      });
    }

    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  // 4) 커밋 이후는 전부 best-effort — 서명은 이미 커밋됐으므로 실패해도 200.
  const completion = readCompletionResult(completeData);

  if (completion) {
    await runPostCommitBestEffort({
      supabase,
      tokenHash,
      rawToken: token,
      signatureDataUrl: parsed.data.signatureDataUrl,
      completion,
    });
  }

  return NextResponse.json({ ok: true });
}

async function runPostCommitBestEffort(input: {
  supabase: ReturnType<typeof createAnonClient>;
  tokenHash: string;
  rawToken: string;
  signatureDataUrl: string;
  completion: CompletionResult;
}): Promise<void> {
  const { supabase, tokenHash, rawToken, signatureDataUrl, completion } = input;

  // 4-1) 완결 계약서 렌더 데이터(owner user_id 포함).
  let signedData: SignedContractData | null = null;

  try {
    const { data, error } = await supabase.rpc("get_signed_contract_data", {
      p_token_hash: tokenHash,
    });

    if (error) {
      console.error("[public-sign] 완결 계약 데이터 조회 실패:", error.message);
    } else {
      signedData = parseSignedContractData(data);
    }
  } catch (error) {
    console.error(
      "[public-sign] 완결 계약 데이터 조회 실패:",
      error instanceof Error ? error.message : error,
    );
  }

  // 4-2) 완결 TSA 스탬프 — doc_hash와 상대 서명 이미지를 묶은 결합 다이제스트.
  if (signedData?.docHash) {
    try {
      const digest = computeCompletionDigest(signedData.docHash, signatureDataUrl);
      const stamped = await getTimestampProvider().stamp(digest);

      if (stamped) {
        const { data: stored, error } = await supabase.rpc(
          "store_completion_tsa_token",
          { p_token_hash: tokenHash, p_token: stamped.token },
        );

        if (error || stored !== true) {
          console.error(
            "[public-sign] 완결 TSA 토큰 저장 실패:",
            error?.message ?? "write-once 거부",
          );
        }
      }
    } catch (error) {
      console.error(
        "[public-sign] 완결 TSA 스탬프 실패:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  // 4-3) 완결증명서 데이터(TSA 저장 뒤에 조회해 토큰 지문을 증명서에 반영).
  let certificate: ReturnType<typeof parseCertificateData> = null;

  try {
    const { data, error } = await supabase.rpc("get_certificate_data", {
      p_token_hash: tokenHash,
    });

    if (error) {
      console.error("[public-sign] 완결증명서 데이터 조회 실패:", error.message);
    } else {
      certificate = parseCertificateData(data, {
        tsaUrl: getTimestampEnv().TSA_URL ?? null,
      });
    }
  } catch (error) {
    console.error(
      "[public-sign] 완결증명서 데이터 조회 실패:",
      error instanceof Error ? error.message : error,
    );
  }

  // 4-4) 첨부 PDF 2종 — 하나라도 실패하면 본문 다운로드 링크 폴백으로 전환.
  let attachments: EmailAttachment[] | undefined;

  try {
    if (signedData && certificate) {
      const [contractPdf, certificatePdf] = await Promise.all([
        renderContractPdf(signedData.model),
        renderCertificatePdf(certificate),
      ]);

      attachments = [
        {
          filename: `contract-${completion.contractId}.pdf`,
          content: contractPdf.toString("base64"),
        },
        {
          filename: `certificate-${completion.contractId}.pdf`,
          content: certificatePdf.toString("base64"),
        },
      ];
    }
  } catch (error) {
    attachments = undefined;
    console.error(
      "[public-sign] 첨부 PDF 생성 실패:",
      error instanceof Error ? error.message : error,
    );
  }

  // 4-5) 완료 이메일 2통(owner + counterparty) — 본문에 doc_hash 전문.
  const docHash = signedData?.docHash ?? certificate?.docHash ?? "기록 없음";
  const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  const targets = [
    {
      to: completion.ownerEmail,
      downloadUrl: `${siteUrl}/contracts/${completion.contractId}`,
    },
    // 상대방 폴백 링크는 본인이 이미 소지한 토큰 URL — 완료 화면에서 교부 라우트로 연결된다.
    { to: completion.recipientEmail, downloadUrl: `${siteUrl}/sign/${rawToken}` },
  ];

  for (const target of targets) {
    if (!target.to) {
      continue;
    }

    try {
      const rendered = renderCompletionEmail({
        contractTitle: completion.contractTitle,
        docHash,
        downloadUrl: attachments ? null : target.downloadUrl,
        hasAttachments: Boolean(attachments),
      });
      const sent = await getEmailProvider().send({
        to: target.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ...(attachments ? { attachments } : {}),
      });

      if (!sent.ok) {
        console.error("[public-sign] 완료 이메일 발송 실패:", sent.error);
      }
    } catch (error) {
      console.error(
        "[public-sign] 완료 이메일 발송 실패:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  // 4-6) posthog — anon 방문자 id를 만들지 않고 owner user_id로만 계측한다.
  if (signedData) {
    try {
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: signedData.ownerUserId,
        event: "contract_counterparty_signed",
        properties: { contract_id: completion.contractId },
      });
      await posthog.flush();
    } catch (error) {
      console.error(
        "[public-sign] posthog 캡처 실패:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}

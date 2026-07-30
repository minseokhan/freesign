import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import {
  buildCertificateProps,
  type CertificateEventRow,
  type CertificateRequestRow,
  type CertificateSignatureRow,
} from "@/lib/contracts/certificate";
import { renderCertificatePdf } from "@/lib/contracts/render-pdf";
import { assertOwned, notDeleted } from "@/lib/db";
import { getTimestampEnv } from "@/lib/env";
import { captureServerException } from "@/lib/posthog-server";
import { createClient } from "@/lib/supabase/server";
import { GENERIC_API_ERROR } from "@/lib/api-error";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 30;

type ContractRow = {
  id: string;
  title: string;
  doc_hash: string | null;
  signature_meta: Json | null;
};

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// owner용 완결증명서 — counterparty 서명이 존재하는(맞서명 완결) 계약만 발급한다.
// anon(토큰) 교부 라우트는 step 8 소관.
export async function GET(_request: Request, context: RouteContext) {
  const user = await requireUser();
  const { id } = await context.params;

  if (!id.trim()) {
    return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  }

  const supabase = await createClient();
  const isOwned = await assertOwned(supabase, "contracts", id);

  if (!isOwned) {
    return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: contractData, error: contractError } = await notDeleted(
    supabase
      .from("contracts")
      .select("id,title,doc_hash,signature_meta")
      .eq("id", id),
  ).maybeSingle();

  if (contractError) {
    await captureServerException(contractError, user.id, {
      route: "contracts/certificate",
    });
    return NextResponse.json({ error: GENERIC_API_ERROR }, { status: 500 });
  }

  if (!contractData) {
    return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  }

  const contract = contractData as ContractRow;

  const [signaturesResult, requestResult, eventsResult] = await Promise.all([
    supabase
      .from("contract_signatures")
      .select("party,signer_name,signer_email,signed_at,consent,meta")
      .eq("contract_id", contract.id)
      .order("signed_at", { ascending: true }),
    supabase
      .from("signature_requests")
      .select(
        "recipient_email,frozen_doc_hash,sent_tsa_token,completion_tsa_token,completed_at",
      )
      .eq("contract_id", contract.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("contract_events")
      .select("actor,from_status,to_status,event_type,created_at")
      .eq("contract_id", contract.id)
      .order("created_at", { ascending: true }),
  ]);

  const queryError =
    signaturesResult.error ?? requestResult.error ?? eventsResult.error;

  if (queryError) {
    await captureServerException(queryError, user.id, {
      route: "contracts/certificate",
    });
    return NextResponse.json({ error: GENERIC_API_ERROR }, { status: 500 });
  }

  const certificate = buildCertificateProps({
    contract,
    signatures: (signaturesResult.data ?? []) as CertificateSignatureRow[],
    request: (requestResult.data ?? null) as CertificateRequestRow | null,
    events: (eventsResult.data ?? []) as CertificateEventRow[],
    tsaUrl: getTimestampEnv().TSA_URL ?? null,
  });

  if (!certificate) {
    return NextResponse.json(
      { error: "맞서명이 완결된 계약만 완결증명서를 발급할 수 있습니다." },
      { status: 409 },
    );
  }

  const pdfBuffer = await renderCertificatePdf(certificate);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="certificate-${contract.id}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}

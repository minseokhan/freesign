import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import {
  mapContractPdfProps,
  toCounterpartySignature,
  type CounterpartySignatureRow,
} from "@/lib/contracts/pdf";
import { renderContractPdf } from "@/lib/contracts/render-pdf";
import { assertOwned, notDeleted } from "@/lib/db";
import {
  captureServerException,
  getPostHogClient,
} from "@/lib/posthog-server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 30;

const CONTRACT_ARTIFACTS_BUCKET = "contract-artifacts";

type ContractRow = Pick<
  Database["public"]["Tables"]["contracts"]["Row"],
  | "id"
  | "title"
  | "scope"
  | "amount"
  | "start_date"
  | "end_date"
  | "status"
  | "clauses"
  | "plain_summary"
  | "doc_hash"
  | "signature_image_path"
  | "signature_meta"
> & {
  client: {
    name: string;
  } | null;
};

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

  const { data, error } = await notDeleted(
    supabase
      .from("contracts")
      .select(
        "id,title,scope,amount,start_date,end_date,status,clauses,plain_summary,doc_hash,signature_image_path,signature_meta,client:clients(name)",
      )
      .eq("id", id),
  ).maybeSingle();

  if (error) {
    await captureServerException(error, user.id, { route: "contracts/pdf" });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  }

  const contract = data as ContractRow;
  const signatureImageDataUri = contract.signature_image_path
    ? await downloadSignatureImageDataUri(supabase, contract.signature_image_path)
    : null;

  // 맞서명 계약이면 상대방 서명(DB base64)을 owner 서명 아래에 함께 렌더한다(0022).
  const { data: counterpartyData, error: counterpartyError } = await supabase
    .from("contract_signatures")
    .select("signer_name,signer_email,signed_at,signature_image_data")
    .eq("contract_id", contract.id)
    .eq("party", "counterparty")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (counterpartyError) {
    await captureServerException(counterpartyError, user.id, {
      route: "contracts/pdf",
    });
    return NextResponse.json({ error: counterpartyError.message }, { status: 500 });
  }

  const document = mapContractPdfProps({
    contract,
    clientName: contract.client?.name ?? null,
    signatureImageDataUri,
    counterpartySignature: toCounterpartySignature(
      (counterpartyData ?? null) as CounterpartySignatureRow | null,
    ),
  });
  const pdfBuffer = await renderContractPdf(document);
  const contractPdfKey = `${user.id}/${contract.id}/contract.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(CONTRACT_ARTIFACTS_BUCKET)
    .upload(contractPdfKey, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    await captureServerException(uploadError, user.id, {
      route: "contracts/pdf",
    });
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("contracts")
    .update({ contract_pdf_url: contractPdfKey })
    .eq("id", contract.id);

  if (updateError) {
    await captureServerException(updateError, user.id, {
      route: "contracts/pdf",
    });
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${contract.id}`);

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "contract_pdf_downloaded", properties: { contract_id: contract.id } });
  await posthog.flush();

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="contract-${contract.id}.pdf"`,
      "cache-control": "private, no-store",
      "x-freesign-pdf-storage-key": contractPdfKey,
    },
  });
}

async function downloadSignatureImageDataUri(
  supabase: Awaited<ReturnType<typeof createClient>>,
  key: string,
) {
  const { data, error } = await supabase.storage
    .from(CONTRACT_ARTIFACTS_BUCKET)
    .download(key);

  if (error || !data) {
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  const contentType = data.type || "image/png";
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return `data:${contentType};base64,${base64}`;
}

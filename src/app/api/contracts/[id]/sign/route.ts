import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { canTransitionContractStatus } from "@/lib/contract-status";
import {
  captureServerException,
  getPostHogClient,
} from "@/lib/posthog-server";
import { createClient } from "@/lib/supabase/server";
import { createV1SignatureProvider } from "@/services/signature/provider";
import type { Database, Json } from "@/types/database";

export const runtime = "nodejs";

const SIGNATURE_BUCKET = "contract-artifacts";

type ContractStatus = Database["public"]["Enums"]["contract_status"];

const signRequestSchema = z.object({
  signatureDataUrl: z
    .string()
    .regex(
      /^data:image\/png;base64,[A-Za-z0-9+/=]+$/,
      "PNG 서명 데이터가 필요합니다.",
    ),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await requireUser();
  const { id } = await context.params;

  if (!id.trim()) {
    return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = signRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "서명 데이터를 확인해 주세요." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id,status,clauses")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (contractError) {
    await captureServerException(contractError, user.id, {
      route: "contracts/sign",
    });
    return NextResponse.json({ error: contractError.message }, { status: 500 });
  }

  if (!contract) {
    return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  }

  const fromStatus = contract.status as ContractStatus;

  if (!canTransitionContractStatus(fromStatus, "signed")) {
    return NextResponse.json(
      { error: "초안 상태의 계약만 서명할 수 있습니다." },
      { status: 409 },
    );
  }

  const signatureImagePath = `${user.id}/${id}/signature.png`;
  const signatureBytes = decodePngDataUrl(parsed.data.signatureDataUrl);
  const { error: uploadError } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .upload(signatureImagePath, signatureBytes, {
      contentType: "image/png",
      upsert: true,
    });

  if (uploadError) {
    await captureServerException(uploadError, user.id, {
      route: "contracts/sign",
    });
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const signatureProvider = createV1SignatureProvider();
  const docHash = signatureProvider.computeDocHash(
    Array.isArray(contract.clauses)
      ? (contract.clauses as Record<string, unknown>[])
      : [],
  );
  const signatureMeta = {
    signer: user.email ?? user.id,
    signed_at: new Date().toISOString(),
    ip: getRequestIp(request),
    ua: request.headers.get("user-agent") ?? "unknown",
  };

  const { data: updatedContractId, error: signError } = await supabase.rpc(
    "sign_contract_with_event",
    {
      p_contract_id: id,
      p_signature_image_path: signatureImagePath,
      p_doc_hash: docHash,
      p_signature_meta: signatureMeta as Json,
      p_actor: user.id,
      p_event_type: "signed",
      p_meta: {
        provider: "v1",
        legalEffect: "record",
        doc_hash: docHash,
        signature_image_path: signatureImagePath,
        ip: signatureMeta.ip,
        ua: signatureMeta.ua,
      },
    },
  );

  if (signError) {
    await captureServerException(signError, user.id, {
      route: "contracts/sign",
    });
    return NextResponse.json({ error: signError.message }, { status: 500 });
  }

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${id}`);

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "contract_signed", properties: { contract_id: id } });
  await posthog.flush();

  return NextResponse.json({
    ok: true,
    id: updatedContractId,
    legalEffect: "record",
  });
}

function decodePngDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");

  return Uint8Array.from(Buffer.from(base64, "base64"));
}

function getRequestIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

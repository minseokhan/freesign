import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { assertOwned, notDeleted } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const runtime = "nodejs";

const CONTRACT_ARTIFACTS_BUCKET = "contract-artifacts";
const SIGNED_URL_TTL_SECONDS = 300;

type ContractRow = Pick<
  Database["public"]["Tables"]["contracts"]["Row"],
  "id" | "source_pdf_url"
>;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  await requireUser();
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
    supabase.from("contracts").select("id,source_pdf_url").eq("id", id),
  ).maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const contract = data as ContractRow | null;

  if (!contract?.source_pdf_url) {
    return NextResponse.json(
      { error: "원본 계약서 PDF가 없습니다." },
      { status: 404 },
    );
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(CONTRACT_ARTIFACTS_BUCKET)
    .createSignedUrl(contract.source_pdf_url, SIGNED_URL_TTL_SECONDS);

  if (signedError || !signed?.signedUrl) {
    return NextResponse.json(
      {
        error: signedError?.message ?? "원본 계약서 PDF를 불러오지 못했습니다.",
      },
      { status: 500 },
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}

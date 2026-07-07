import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { toContractDraftPreview } from "@/lib/contracts/draft";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { contractDraftInputSchema } from "@/lib/validation/contract";
import { generateContractDraft } from "@/services/ai/contract-draft";

export async function POST(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => null);
  const parsed = contractDraftInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "입력값을 확인해 주세요.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseClient();
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("name")
    .eq("id", parsed.data.client_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (clientError) {
    return NextResponse.json(
      { ok: false, error: clientError.message },
      { status: 500 },
    );
  }

  if (!client) {
    return NextResponse.json(
      { ok: false, error: "클라이언트를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { ok: false, error: profileError.message },
      { status: 500 },
    );
  }

  const draft = await generateContractDraft({
    freelancerName: profile?.display_name ?? user.email ?? "프리랜서",
    clientName: client.name,
    scope: parsed.data.scope,
    amount: parsed.data.amount,
    startDate: parsed.data.start_date,
    endDate: parsed.data.end_date,
    dueDate: parsed.data.due_date,
  });

  return NextResponse.json({
    ok: true,
    draft: toContractDraftPreview(draft),
  });
}

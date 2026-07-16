import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { toContractDraftPreview } from "@/lib/contracts/draft";
import {
  captureServerException,
  getPostHogClient,
} from "@/lib/posthog-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { contractDraftInputSchema } from "@/lib/validation/contract";
import { generateContractDraft } from "@/services/ai/contract-draft";

export async function POST(request: Request) {
  const user = await requireUser();

  const limit = await checkRateLimit(RATE_LIMITS.aiDraft);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

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
    await captureServerException(clientError, user.id, {
      route: "contracts/draft",
    });
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
    await captureServerException(profileError, user.id, {
      route: "contracts/draft",
    });
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

  // source(ai|skeleton)로 AI 가용률을 관측한다. 저장 전 이탈도 이 이벤트로 보인다.
  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "contract_draft_previewed", properties: { source: draft.source } });
  await posthog.flush();

  return NextResponse.json({
    ok: true,
    draft: toContractDraftPreview({ ...draft, title: parsed.data.title }),
  });
}

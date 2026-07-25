// 온디맨드 AI 계약 인사이트(Pro 전용). requireUser → assertProFeature(free 402+upsell) →
// 소유 계약 조회 → consumeRateLimit → generateContractInsight → contract_insights 저장 → 최신 반환.
// service_role 금지 · 시크릿/외부 API는 서버 라우트에서만(CLAUDE.md).
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { assertProFeature } from "@/lib/plan";
import {
  captureServerException,
  getPostHogClient,
} from "@/lib/posthog-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import {
  generateContractInsight,
  type ContractInsightClause,
} from "@/services/ai/contract-insight";

export const runtime = "nodejs";

function normalizeClauses(raw: unknown): ContractInsightClause[] {
  if (!Array.isArray(raw)) return [];

  const result: ContractInsightClause[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.title !== "string") continue;
    result.push({
      title: record.title,
      body: typeof record.body === "string" ? record.body : "",
      plain_summary: typeof record.plain_summary === "string" ? record.plain_summary : "",
    });
  }
  return result;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();

  const gate = await assertProFeature();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.message, upsell: true },
      { status: 402 },
    );
  }

  const { id } = await params;
  const supabase = await createSupabaseClient();

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id,title,clauses,plain_summary")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (contractError) {
    await captureServerException(contractError, user.id, {
      route: "contracts/insights",
    });
    return NextResponse.json({ ok: false, error: "요청을 처리하지 못했습니다." }, { status: 500 });
  }

  if (!contract) {
    return NextResponse.json({ ok: false, error: "계약을 찾을 수 없습니다." }, { status: 404 });
  }

  const limit = await checkRateLimit(RATE_LIMITS.aiContractInsight);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const insight = await generateContractInsight({
    title: contract.title,
    plainSummary: contract.plain_summary,
    clauses: normalizeClauses(contract.clauses),
  });

  const { error: insertError } = await supabase.from("contract_insights").insert({
    user_id: user.id,
    contract_id: contract.id,
    summary: insight.summary,
    risk_level: insight.risk_level,
    findings: insight.findings as unknown as Json,
    model: insight.model,
    source: insight.source,
  });

  if (insertError) {
    await captureServerException(insertError, user.id, {
      route: "contracts/insights",
    });
    return NextResponse.json({ ok: false, error: "인사이트 저장에 실패했습니다." }, { status: 500 });
  }

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "contract_insight_generated",
    properties: { contract_id: contract.id, source: insight.source, risk_level: insight.risk_level },
  });
  await posthog.flush();

  return NextResponse.json({
    ok: true,
    insight: {
      summary: insight.summary,
      risk_level: insight.risk_level,
      findings: insight.findings,
      source: insight.source,
    },
  });
}

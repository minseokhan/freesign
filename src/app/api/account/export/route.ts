import { NextResponse } from "next/server";

import { EXPORT_TABLES, stripColumns } from "@/lib/account-export";
import { GENERIC_API_ERROR } from "@/lib/api-error";
import { requireUser } from "@/lib/auth";
import {
  captureServerException,
  getPostHogClient,
} from "@/lib/posthog-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * 개인정보보호법상 열람·전송 요구(제35조)에 대응하는 데이터 내보내기.
 * 기계 판독이 가능한 JSON으로 내려주며, **무료 플랜도 사용할 수 있다** —
 * 열람권은 요금제로 제한할 수 없다(Pro 게이트가 걸린 /api/reports와 다른 점).
 */
export async function GET() {
  const user = await requireUser();

  const limit = await checkRateLimit(RATE_LIMITS.accountExport);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const supabase = await createSupabaseClient();
  const data: Record<string, Record<string, unknown>[]> = {};

  for (const spec of EXPORT_TABLES) {
    const { data: rows, error } = await supabase.from(spec.table).select("*");

    if (error) {
      await captureServerException(error, user.id, {
        route: "account_export",
        table: spec.table,
      });
      return NextResponse.json({ error: GENERIC_API_ERROR }, { status: 500 });
    }

    data[spec.table] = stripColumns(rows ?? [], spec.omit);
  }

  const exportedAt = new Date().toISOString();
  const payload = {
    service: "Maedeup",
    exportedAt,
    account: { id: user.id, email: user.email ?? null },
    notes: [
      "이 파일은 매듭이 보관 중인 회원님의 데이터 전체입니다.",
      "서명 링크 토큰과 타임스탬프 토큰 원문은 보안상 제외했습니다.",
      "서명 이미지 원본은 용량 문제로 제외했으며 저장 경로만 포함합니다.",
    ],
    data,
  };

  const posthog = getPostHogClient();
  posthog.capture({ distinctId: user.id, event: "account_data_exported" });
  await posthog.flush();

  const filename = `maedeup-data-${exportedAt.slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}

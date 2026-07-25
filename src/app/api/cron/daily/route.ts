// 단일 일일 크론 진입점. Vercel Hobby는 크론 1일 1회 제약이라 개별 잡 대신
// 이 라우트가 dunning·recurring 스윕을 순차 호출한다(각각 try/catch 격리).
// 인가는 CRON_SECRET Bearer로 fail-closed. 실제 멀티유저 쓰기는 각 스윕의
// SECURITY DEFINER RPC(assert_cron_secret 게이트) 내부에서만 일어난다.
import { NextResponse } from "next/server";

import { authorizeCron } from "@/app/api/cron/_lib/authorize";
import { runDunningSweep } from "@/lib/cron/dunning-sweep";
import { runRecurringSweep } from "@/lib/cron/recurring-sweep";
import { getCronEnv } from "@/lib/env";

export const runtime = "nodejs";

// 각 스윕을 try/catch로 격리해 하나가 실패해도 나머지는 진행한다.
async function runIsolated(
  name: string,
  results: Record<string, unknown>,
  fn: () => Promise<unknown>,
) {
  try {
    results[name] = { ok: true, ...(await fn() as object) };
  } catch (error) {
    results[name] = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(req: Request) {
  const { CRON_SECRET } = getCronEnv();

  if (!authorizeCron(req, CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  await runIsolated("dunning", results, () => runDunningSweep(CRON_SECRET));
  await runIsolated("recurring", results, () => runRecurringSweep(CRON_SECRET));

  return NextResponse.json({ ok: true, ran: results });
}

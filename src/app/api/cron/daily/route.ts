// 단일 일일 크론 진입점. Vercel Hobby는 크론 1일 1회 제약이라 개별 잡 대신
// 이 라우트가 dunning·recurring 스윕을 순차 호출한다(각각 try/catch 격리).
// 인가는 CRON_SECRET Bearer로 fail-closed. 실제 멀티유저 쓰기는 각 스윕의
// SECURITY DEFINER RPC(assert_cron_secret 게이트) 내부에서만 일어난다.
import { NextResponse } from "next/server";

import { authorizeCron } from "@/app/api/cron/_lib/authorize";
import { runDunningSweep } from "@/lib/cron/dunning-sweep";
import { runRecurringSweep } from "@/lib/cron/recurring-sweep";
import { getCronEnv } from "@/lib/env";
import { captureServerException } from "@/lib/posthog-server";

export const runtime = "nodejs";
// 스윕이 후보 수만큼 외부 API(Claude·Resend)를 호출하므로 기본 10초로는 부족하다.
export const maxDuration = 60;

// 각 스윕을 try/catch로 격리해 하나가 실패해도 나머지는 진행한다.
// 실패는 반드시 로그·에러 트래킹에 남긴다 — 이 경계는 세션 없는 특권 경로라
// 조용히 죽으면(200 ok:true) 며칠이 지나도 아무도 모른다(대시보드 #37).
async function runIsolated(
  name: string,
  results: Record<string, unknown>,
  fn: () => Promise<unknown>,
): Promise<boolean> {
  try {
    results[name] = { ok: true, ...(await fn() as object) };
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cron] ${name} 스윕 실패:`, message);
    await captureServerException(error, undefined, {
      route: "cron/daily",
      sweep: name,
    });
    results[name] = { ok: false, error: message };
    return false;
  }
}

export async function GET(req: Request) {
  const { CRON_SECRET } = getCronEnv();

  if (!authorizeCron(req, CRON_SECRET)) {
    // 시크릿 값 자체는 절대 로그에 남기지 않는다(헤더 유무만 기록).
    console.warn("[cron] unauthorized", {
      hasAuthorizationHeader: Boolean(req.headers.get("authorization")),
    });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  const dunningOk = await runIsolated("dunning", results, () => runDunningSweep(CRON_SECRET));
  const recurringOk = await runIsolated("recurring", results, () => runRecurringSweep(CRON_SECRET));
  const ok = dunningOk && recurringOk;

  // 하나라도 실패하면 5xx — Vercel Cron 실패 알림이 동작해야 탐지된다.
  return NextResponse.json({ ok, ran: results }, { status: ok ? 200 : 500 });
}

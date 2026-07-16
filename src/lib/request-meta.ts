// 라우트 핸들러 공용 요청 메타 추출 — 기존 sign route에서 옮겨와
// 공개 서명 API(anon)와 공유한다.
import { createHash } from "node:crypto";

export function getRequestIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

export function getRequestUserAgent(request: Request): string {
  return request.headers.get("user-agent") ?? "unknown";
}

/** anon 레이트리밋 키 — 원본 IP를 저장하지 않도록 sha256 hex로만 넘긴다. */
export function getRequestIpHash(request: Request): string {
  return createHash("sha256").update(getRequestIp(request), "utf8").digest("hex");
}

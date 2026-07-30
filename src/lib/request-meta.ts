// 라우트 핸들러 공용 요청 메타 추출 — 기존 sign route에서 옮겨와
// 공개 서명 API(anon)와 공유한다.
import { createHash } from "node:crypto";

export function getRequestIp(request: Request): string {
  return getHeadersIp(request.headers);
}

/** RSC 페이지는 Request가 없고 headers()만 있으므로 Headers 기반 오버로드를 함께 둔다. */
export function getHeadersIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return headers.get("x-real-ip") ?? "unknown";
}

export function getHeadersIpHash(headers: Headers): string {
  return createHash("sha256").update(getHeadersIp(headers), "utf8").digest("hex");
}

export function getRequestUserAgent(request: Request): string {
  return request.headers.get("user-agent") ?? "unknown";
}

/** anon 레이트리밋 키 — 원본 IP를 저장하지 않도록 sha256 hex로만 넘긴다. */
export function getRequestIpHash(request: Request): string {
  return createHash("sha256").update(getRequestIp(request), "utf8").digest("hex");
}

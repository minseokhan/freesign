/**
 * OAuth 콜백 등에서 사용자 제어 `next` 파라미터를 안전한 내부 경로로만 해석한다.
 *
 * 단순 문자열 접두 검사(`startsWith("/") && !startsWith("//")`)는 백슬래시 우회
 * (`/\evil.com` → WHATWG 파서가 `//evil.com`으로 정규화)나 탭/개행 우회를 막지 못한다.
 * 따라서 origin을 기준으로 실제 파싱한 뒤 결과 origin이 자기 origin과 일치하는 경우에만
 * 통과시키고, 벗어나면 fallback으로 돌린다.
 */
export function getSafeRedirectPath(
  next: string | null | undefined,
  origin: string,
  fallback = "/dashboard",
): string {
  if (!next) return fallback;

  try {
    const target = new URL(next, origin);
    if (target.origin !== origin) return fallback;
    return target.pathname + target.search + target.hash;
  } catch {
    return fallback;
  }
}

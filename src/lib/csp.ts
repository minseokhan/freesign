// 응답 CSP를 한 곳에서 만든다. middleware가 요청마다 nonce를 끼워 넣어야 해서
// next.config의 정적 headers()가 아니라 여기서 조립한다.
//
// script-src만 nonce를 쓴다. Next.js는 요청 헤더의 CSP에서 nonce를 읽어
// 자신이 내보내는 인라인 부트스트랩 스크립트에 같은 nonce를 붙인다.
// 'self'를 함께 두는 이유: 청크 <script src="/_next/...">를 nonce 없이도 허용해
// 브라우저·프레임워크 조합에 따라 화면이 통째로 죽는 것을 막는다.
// dev는 webpack이 eval 기반 소스맵을 쓰므로 'unsafe-eval'이 필요하다.
export function buildContentSecurityPolicy(input: {
  nonce: string;
  isDev: boolean;
}): string {
  const scriptSrc = [
    "script-src 'self'",
    `'nonce-${input.nonce}'`,
    input.isDev ? "'unsafe-eval'" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
  ].join("; ");
}

export function generateCspNonce(): string {
  return btoa(crypto.randomUUID());
}

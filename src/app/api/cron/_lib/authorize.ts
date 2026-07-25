// 크론 요청 인가 순수 유틸. Vercel Cron은 `Authorization: Bearer ${CRON_SECRET}`를 붙여 호출한다.
// fail-closed: 기대 시크릿이 빈 값이면 어떤 요청도 통과시키지 않는다(미설정 시 개방 방지).

const BEARER_PREFIX = "Bearer ";

export function authorizeCron(req: Request, expectedSecret: string): boolean {
  if (!expectedSecret) return false;

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith(BEARER_PREFIX)) return false;

  const token = header.slice(BEARER_PREFIX.length);
  return token.length > 0 && token === expectedSecret;
}

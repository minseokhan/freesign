// 크론 요청 인가 순수 유틸. Vercel Cron은 `Authorization: Bearer ${CRON_SECRET}`를 붙여 호출한다.
// fail-closed: 기대 시크릿이 빈 값이면 어떤 요청도 통과시키지 않는다(미설정 시 개방 방지).
import { createHash, timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = "Bearer ";

/**
 * 상수시간 비교(대시보드 #29). `===`는 첫 불일치 바이트에서 즉시 반환해 응답 시간이
 * 일치 접두 길이에 따라 달라진다. sha256으로 길이를 32바이트로 고정해
 * timingSafeEqual의 length 예외와 길이 노출을 함께 없앤다.
 */
function secretsMatch(token: string, expectedSecret: string): boolean {
  const actual = createHash("sha256").update(token, "utf8").digest();
  const expected = createHash("sha256").update(expectedSecret, "utf8").digest();

  return timingSafeEqual(actual, expected);
}

export function authorizeCron(req: Request, expectedSecret: string): boolean {
  if (!expectedSecret) return false;

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith(BEARER_PREFIX)) return false;

  const token = header.slice(BEARER_PREFIX.length);
  return token.length > 0 && secretsMatch(token, expectedSecret);
}

// PostHog 프록시. 광고차단기가 posthog.com 요청을 막기 때문에 동일 출처(/ingest)로 받는다.
//
// 원래는 next.config의 rewrite였다. 그런데 동일 출처라는 것은 브라우저가 path="/" 쿠키를
// 함께 보낸다는 뜻이고 — Supabase 세션 토큰 sb-*-auth-token이 여기 포함된다 — Next의 rewrite는
// 받은 Cookie 헤더를 그대로 외부 호스트로 넘긴다. httpOnly·SameSite는 이 경로를 막지 못한다.
// 그래서 상류 요청을 직접 조립해 필요한 헤더만 실어 보낸다.
export const runtime = "nodejs";

const EVENT_HOST = "https://us.i.posthog.com";
const ASSET_HOST = "https://us-assets.i.posthog.com";

// 상류로 넘길 헤더 화이트리스트. 여기 없는 것은 전부 버린다(cookie·authorization 포함).
// x-forwarded-for는 PostHog의 GeoIP 판정에 쓰이고 rewrite 시절에도 전달되던 값이라 유지한다.
const FORWARDED_HEADERS = ["content-type", "user-agent", "x-forwarded-for"];

function upstreamUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  const path = url.pathname.replace(/^\/ingest/, "");
  const host = path.startsWith("/static/") || path.startsWith("/array/") ? ASSET_HOST : EVENT_HOST;

  return `${host}${path}${url.search}`;
}

async function proxy(request: Request): Promise<Response> {
  const headers = new Headers();

  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);

    if (value) {
      headers.set(name, value);
    }
  }

  // 압축된(gzip-js) 이벤트 본문이 있으므로 텍스트가 아니라 바이트로 넘긴다.
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  const upstream = await fetch(upstreamUrl(request.url), {
    method: request.method,
    headers,
    body,
  });

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  const cacheControl = upstream.headers.get("cache-control");

  if (contentType) {
    responseHeaders.set("content-type", contentType);
  }

  if (cacheControl) {
    responseHeaders.set("cache-control", cacheControl);
  }

  // 상류가 심으려는 쿠키는 우리 출처의 쿠키가 되므로 돌려주지 않는다.
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(request: Request) {
  return proxy(request);
}

export async function POST(request: Request) {
  return proxy(request);
}

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../route";

// PostHog 프록시는 광고차단기 우회를 위해 동일 출처(/ingest)로 받는다. 동일 출처라는 것은
// 브라우저가 path="/" 쿠키 — 즉 Supabase 세션 토큰 sb-*-auth-token — 을 함께 보낸다는 뜻이다.
// next.config의 리라이트는 이 Cookie 헤더를 그대로 외부로 넘겼다. 여기서 벗겨낸다.
describe("/ingest PostHog 프록시", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // 호출마다 새 Response를 만든다 — 본문은 한 번만 읽을 수 있다.
    fetchMock.mockImplementation(
      async () =>
        new Response('{"status":1}', {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "upstream=1; Path=/",
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  function requestWithCookies(url: string, init?: RequestInit) {
    return new Request(url, {
      ...init,
      headers: {
        cookie: "sb-jbfxkcjeoqwcdsxuemug-auth-token=super-secret-session; ph_token=1",
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (test)",
        "x-forwarded-for": "203.0.113.9",
      },
    });
  }

  function forwardedCall(index = 0) {
    const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return { url, init, headers: new Headers(init.headers) };
  }

  it("세션 쿠키를 상류로 전달하지 않는다", async () => {
    await POST(
      requestWithCookies("https://maedeup.app/ingest/e/?ip=1", {
        method: "POST",
        body: '{"event":"$pageview"}',
      }),
    );

    expect(forwardedCall().headers.get("cookie")).toBeNull();
  });

  it("PostHog가 필요로 하는 헤더는 그대로 넘긴다", async () => {
    await POST(
      requestWithCookies("https://maedeup.app/ingest/e/", {
        method: "POST",
        body: "{}",
      }),
    );

    const { headers } = forwardedCall();
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("user-agent")).toBe("Mozilla/5.0 (test)");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
  });

  it("이벤트 경로는 us.i.posthog.com으로, 쿼리스트링을 유지해 보낸다", async () => {
    await POST(
      requestWithCookies("https://maedeup.app/ingest/e/?ip=1&ver=1.2", {
        method: "POST",
        body: '{"event":"$pageview"}',
      }),
    );

    expect(forwardedCall().url).toBe("https://us.i.posthog.com/e/?ip=1&ver=1.2");
  });

  it("static·array 경로는 에셋 호스트로 보낸다", async () => {
    await GET(requestWithCookies("https://maedeup.app/ingest/static/array.js"));
    await GET(requestWithCookies("https://maedeup.app/ingest/array/abc/config.js"));

    expect(forwardedCall(0).url).toBe("https://us-assets.i.posthog.com/static/array.js");
    expect(forwardedCall(1).url).toBe("https://us-assets.i.posthog.com/array/abc/config.js");
  });

  it("본문을 바이트 그대로 전달한다(gzip 압축 이벤트 대비)", async () => {
    await POST(
      requestWithCookies("https://maedeup.app/ingest/i/v0/e/", {
        method: "POST",
        body: '{"event":"contract_created"}',
      }),
    );

    const { init } = forwardedCall();
    expect(init.method).toBe("POST");
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(
      '{"event":"contract_created"}',
    );
  });

  it("상류 응답의 set-cookie는 브라우저로 돌려주지 않는다", async () => {
    const response = await POST(
      requestWithCookies("https://maedeup.app/ingest/e/", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
  });
});

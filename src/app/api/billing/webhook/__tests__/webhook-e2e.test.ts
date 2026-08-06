// @vitest-environment node
import { Webhook } from "standardwebhooks";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createAnonClient } from "@/lib/supabase/anon";
import {
  POLAR_CUSTOMER_ID,
  POLAR_SUBSCRIPTION_ID,
  polarSubscriptionFixture,
} from "@/test/fixtures/polar-subscription";

// 옆의 route.test.ts는 Webhooks 어댑터와 applySubscriptionEvent를 둘 다 mock해 "배선"만 본다.
// 여기서는 그 사이를 실물로 통과시킨다: 실제 서명 검증 → Polar SDK zod 스키마 → 우리 인자 매핑.
// 유일하게 대체하는 것은 DB 클라이언트뿐이다(DB 쪽 경계는 billing-webhook-rpc.test.ts가 맡는다).
//
// 이게 없으면 Polar 페이로드 모양이 바뀌었을 때 아무 데서도 안 걸린다.
// applySubscriptionEvent는 customer.externalId가 없으면 console.error 후 **조용히 return** 하고
// 라우트는 200을 돌려준다 — 결제한 사용자가 Free로 남는 무증상 실패다(billing-webhook.ts:35).
vi.mock("@/lib/supabase/anon", () => ({ createAnonClient: vi.fn() }));

const WEBHOOK_SECRET = "test-polar-webhook-secret-value";
const USER_ID = "8f7e2a10-3c4b-4d5e-9f01-2a3b4c5d6e7f";
const SIGNED_AT = new Date("2026-08-06T03:00:00.000Z");

type WebhookBody = {
  type: string;
  data: ReturnType<typeof polarSubscriptionFixture>;
};

function webhookBody(
  type: string,
  data: ReturnType<typeof polarSubscriptionFixture>,
): WebhookBody & { timestamp: string } {
  return { type, timestamp: SIGNED_AT.toISOString(), data };
}

function signedRequest(body: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(body);
  // Polar SDK는 원문 시크릿을 base64로 감싼 뒤 standardwebhooks에 넘긴다(sdk/webhooks.ts:140).
  const webhook = new Webhook(Buffer.from(secret, "utf-8").toString("base64"));
  const messageId = "msg_2aBcDeFgHiJkLmNoPqRsTuVwXy";

  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": messageId,
      "webhook-timestamp": String(Math.floor(SIGNED_AT.getTime() / 1000)),
      "webhook-signature": webhook.sign(messageId, SIGNED_AT, payload),
    },
    body: payload,
  });
}

describe("POST /api/billing/webhook — 서명부터 RPC 인자까지", () => {
  let rpc: ReturnType<typeof vi.fn>;
  let POST: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    // 라우트는 모듈 로드 시점에 process.env를 읽고, getPolarEnv()는 호출 시점에 읽는다 —
    // stub은 import 전에 걸고 파일이 끝날 때까지 유지한다.
    vi.stubEnv("POLAR_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_at_test");
    vi.stubEnv("POLAR_PRODUCT_ID", "3b0c1d2e-4f50-4617-8829-9a0b1c2d3e4f");

    // Polar SDK를 통째로 끌고 오는 무거운 import다 — 가짜 타이머 밖에서 한 번만 한다.
    ({ POST } = (await import("../route")) as unknown as {
      POST: (request: Request) => Promise<Response>;
    });
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // standardwebhooks는 서명 시각과 현재 시각의 차이로 재전송 공격을 막는다.
    vi.useFakeTimers();
    vi.setSystemTime(SIGNED_AT);

    rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createAnonClient).mockReturnValue({ rpc } as unknown as ReturnType<
      typeof createAnonClient
    >);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("서명이 틀리면 403이고 구독 upsert는 시도조차 하지 않는다", async () => {
    const response = await POST(
      signedRequest(
        webhookBody("subscription.active", polarSubscriptionFixture(USER_ID)),
        "attacker-guessed-secret",
      ),
    );

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("유효 서명이면 Polar 페이로드를 그대로 upsert 인자로 옮긴다", async () => {
    const response = await POST(
      signedRequest(
        webhookBody("subscription.active", polarSubscriptionFixture(USER_ID)),
      ),
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);

    const [functionName, args] = rpc.mock.calls[0];
    expect(functionName).toBe("upsert_subscription_from_polar");
    expect(args).toMatchObject({
      p_webhook_secret: WEBHOOK_SECRET,
      // customer.external_id → p_user_id. 이 매핑이 끊기면 결제가 아무에게도 반영되지 않는다.
      p_user_id: USER_ID,
      p_polar_customer_id: POLAR_CUSTOMER_ID,
      p_polar_subscription_id: POLAR_SUBSCRIPTION_ID,
      p_plan: "pro",
      p_status: "active",
      p_current_period_end: "2026-09-01T00:00:00.000Z",
      p_cancel_at_period_end: false,
      p_event_type: "subscription.active",
    });
  });

  it("해지 예약(cancel_at_period_end)은 기간 끝까지 pro를 유지한다", async () => {
    await POST(
      signedRequest(
        webhookBody(
          "subscription.canceled",
          polarSubscriptionFixture(USER_ID, { cancel_at_period_end: true }),
        ),
      ),
    );

    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_plan: "pro",
      p_cancel_at_period_end: true,
      p_event_type: "subscription.canceled",
    });
  });

  it("revoked는 Polar 상태와 무관하게 free·revoked로 즉시 강등한다", async () => {
    const response = await POST(
      // 상태가 아직 active로 와도 강등되어야 한다.
      signedRequest(
        webhookBody(
          "subscription.revoked",
          polarSubscriptionFixture(USER_ID, { status: "active" }),
        ),
      ),
    );

    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_plan: "free",
      p_status: "revoked",
      p_event_type: "subscription.revoked",
    });
  });

  it("external_id가 없으면 소유자를 못 찾아 upsert를 건너뛴다", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      signedRequest(webhookBody("subscription.active", polarSubscriptionFixture(null))),
    );

    // 재전송해도 결과가 같으므로 200이 맞다. 다만 조용히 넘어가므로 로그가 유일한 흔적이다.
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  // 200을 돌려주면 Polar가 재전송하지 않아 이벤트가 영구 유실된다(billing-webhook.ts 주석).
  it("RPC가 실패하면 삼키지 않고 던져 Polar 재시도를 유도한다", async () => {
    rpc.mockResolvedValue({ error: { message: "gate rejected" } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      POST(
        signedRequest(
          webhookBody("subscription.active", polarSubscriptionFixture(USER_ID)),
        ),
      ),
    ).rejects.toThrow(/upsert_subscription_from_polar failed/);

    consoleError.mockRestore();
  });
});

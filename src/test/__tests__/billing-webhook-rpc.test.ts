// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";

import { createUser, runAsAnon } from "../pg";

// 웹훅 체인의 DB 쪽 끝. 라우트~인자 매핑은 webhook/__tests__/webhook-e2e.test.ts가 맡고,
// 여기서는 "그 인자가 실제로 어떤 DB 상태를 만드는가"를 anon 롤로 확인한다.
// service_role 없이 anon만으로 남의 구독 행을 쓰는 경계라(ADR-010) 실행 롤을 바꾸면 의미가 없다.
//
// billing_config는 단일 행 전역 상태다 — 같은 DB를 공유하는 secret-hash-storage.test.ts와
// **같은 값**을 쓴다(둘 다 멱등하게 다시 세팅). 값을 바꾸는 회전 테스트는 두지 않는다.
const BILLING_SECRET = "hash-storage-test-secret";

const CUSTOMER_ID = "cus_polar_test";
const SUBSCRIPTION_ID = "sub_polar_test";
const PERIOD_END = "2026-09-01T00:00:00Z";

describe("upsert_subscription_from_polar — 웹훅이 만드는 DB 상태 (0024·0026)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    await pool.query("select set_billing_webhook_secret($1)", [BILLING_SECRET]);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function upsert(
    userId: string,
    overrides: {
      plan?: string;
      status?: string;
      cancelAtPeriodEnd?: boolean;
      eventType?: string;
      meta?: Record<string, unknown>;
      secret?: string;
    } = {},
  ) {
    return await runAsAnon(
      pool,
      `select upsert_subscription_from_polar($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        overrides.secret ?? BILLING_SECRET,
        userId,
        CUSTOMER_ID,
        SUBSCRIPTION_ID,
        overrides.plan ?? "pro",
        overrides.status ?? "active",
        PERIOD_END,
        overrides.cancelAtPeriodEnd ?? false,
        overrides.eventType ?? "subscription.active",
        JSON.stringify(overrides.meta ?? { polar_status: "active" }),
      ],
    );
  }

  const readSubscription = async (userId: string) =>
    (
      await pool.query(
        `select plan, status, polar_customer_id, polar_subscription_id,
                cancel_at_period_end, current_period_end
           from subscriptions where user_id = $1`,
        [userId],
      )
    ).rows;

  const readEvents = async (userId: string) =>
    (
      await pool.query(
        `select event_type, status, meta from billing_events
          where user_id = $1 order by id`,
        [userId],
      )
    ).rows;

  it("anon 롤 호출만으로 구독 행과 감사 이벤트를 함께 남긴다", async () => {
    const userId = await createUser(pool);

    await upsert(userId);

    expect(await readSubscription(userId)).toEqual([
      {
        plan: "pro",
        status: "active",
        polar_customer_id: CUSTOMER_ID,
        polar_subscription_id: SUBSCRIPTION_ID,
        cancel_at_period_end: false,
        current_period_end: new Date("2026-09-01T00:00:00Z"),
      },
    ]);

    // 구독 행만 바뀌고 이벤트가 없으면 "언제 왜 pro가 됐는지"를 되짚을 수 없다.
    expect(await readEvents(userId)).toEqual([
      {
        event_type: "subscription.active",
        status: "active",
        meta: { polar_status: "active" },
      },
    ]);
  });

  it("revoked는 구독 행을 free로 덮되 이전 이벤트는 지우지 않는다", async () => {
    const userId = await createUser(pool);

    await upsert(userId);
    // Polar는 revoked에도 status: active를 실어 보낼 수 있다 — 강등은 이벤트 종류로 결정된다.
    await upsert(userId, {
      plan: "free",
      status: "revoked",
      eventType: "subscription.revoked",
      meta: { polar_status: "active" },
    });

    const [subscription] = await readSubscription(userId);
    expect(subscription).toMatchObject({ plan: "free", status: "revoked" });

    // append-only 로그 — 강등 이력이 남아야 분쟁 시 되짚을 수 있다.
    expect(await readEvents(userId)).toHaveLength(2);
    expect((await readEvents(userId)).map((row) => row.event_type)).toEqual([
      "subscription.active",
      "subscription.revoked",
    ]);
  });

  // Polar 재전송(5xx 응답 후 재시도)이 구독 행을 복제하면 플랜 판정이 흔들린다.
  it("같은 이벤트를 재전송해도 구독 행은 하나로 유지된다", async () => {
    const userId = await createUser(pool);

    await upsert(userId);
    await upsert(userId);

    expect(await readSubscription(userId)).toHaveLength(1);
    expect(await readEvents(userId)).toHaveLength(2);
  });

  it("해지 예약은 pro를 유지한 채 플래그만 세운다", async () => {
    const userId = await createUser(pool);

    await upsert(userId, {
      cancelAtPeriodEnd: true,
      eventType: "subscription.canceled",
    });

    expect((await readSubscription(userId))[0]).toMatchObject({
      plan: "pro",
      cancel_at_period_end: true,
    });
  });

  // 플랜은 앱이 아니라 DB가 최종적으로 좁힌다 — 웹훅이 뚫려도 없는 등급이 생기면 안 된다.
  it("free·pro 밖의 플랜 값은 거부한다", async () => {
    const userId = await createUser(pool);

    await expect(upsert(userId, { plan: "enterprise" })).rejects.toThrow(
      /invalid plan/,
    );

    expect(await readSubscription(userId)).toHaveLength(0);
    expect(await readEvents(userId)).toHaveLength(0);
  });

  it("시크릿이 틀리면 아무 흔적도 남기지 않는다", async () => {
    const userId = await createUser(pool);

    await expect(upsert(userId, { secret: "wrong-secret-value" })).rejects.toThrow(
      /unauthorized billing webhook call/,
    );

    expect(await readSubscription(userId)).toHaveLength(0);
    expect(await readEvents(userId)).toHaveLength(0);
  });

  it("anon은 구독·감사 테이블에 직접 쓸 수 없다 (RPC만이 경로)", async () => {
    const userId = await createUser(pool);

    await expect(
      runAsAnon(
        pool,
        `insert into subscriptions (user_id, plan, status) values ($1, 'pro', 'active')`,
        [userId],
      ),
    ).rejects.toThrow();

    await expect(
      runAsAnon(
        pool,
        `insert into billing_events (user_id, event_type, status)
         values ($1, 'subscription.active', 'active')`,
        [userId],
      ),
    ).rejects.toThrow();
  });
});

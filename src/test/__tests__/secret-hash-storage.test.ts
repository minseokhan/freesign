// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";

// 0041 회귀 테스트. 크론·웹훅 시크릿을 평문으로 보관하면 DB 덤프 한 번으로
// 세션 없는 특권 경계(크론 스윕·구독 upsert)를 그대로 통과할 수 있다.
//
// cron_config·billing_config는 단일 행 전역 상태라 다른 테스트 파일도 같은 값을 쓴다
// (billing_config는 billing-webhook-rpc.test.ts와 공유). 어느 쪽도 값을 바꾸지 않고
// 같은 값으로만 다시 세팅한다(멱등) — 값을 바꾸면 병렬로 도는 다른 파일이 깨진다.
describe("시크릿 해시 저장 (0041)", () => {
  let pool: Pool;

  const SHARED_CRON_SECRET = "test-cron-secret";
  const BILLING_SECRET = "hash-storage-test-secret";

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    await pool.query("select set_cron_secret($1)", [SHARED_CRON_SECRET]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("set_cron_secret은 평문을 남기지 않고 sha256 hex만 저장한다", async () => {
    const row = await pool.query<{ cron_secret: string; secret_sha256: string }>(
      "select cron_secret, secret_sha256 from cron_config where id = true",
    );

    expect(row.rows[0].cron_secret).toBe("");
    expect(row.rows[0].secret_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.rows[0].secret_sha256).not.toContain(SHARED_CRON_SECRET);
  });

  it("게이트는 원문 시크릿만 통과시킨다", async () => {
    await expect(
      pool.query("select assert_cron_secret($1)", [SHARED_CRON_SECRET]),
    ).resolves.toBeDefined();

    await expect(
      pool.query("select assert_cron_secret($1)", ["wrong-secret-value"]),
    ).rejects.toThrow(/unauthorized cron call/);

    // 저장된 해시 자체를 넘겨도 통과하면 안 된다(덤프 유출 = 즉시 통과 방지).
    const stored = await pool.query<{ secret_sha256: string }>(
      "select secret_sha256 from cron_config where id = true",
    );
    await expect(
      pool.query("select assert_cron_secret($1)", [stored.rows[0].secret_sha256]),
    ).rejects.toThrow(/unauthorized cron call/);
  });

  it("웹훅 게이트도 해시 비교로 fail-closed 동작한다", async () => {
    await pool.query("select set_billing_webhook_secret($1)", [BILLING_SECRET]);

    const userId = (
      await pool.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`secret-hash-${crypto.randomUUID()}@example.test`],
      )
    ).rows[0].id;

    await expect(
      pool.query(
        `select upsert_subscription_from_polar(
           $1, $2, 'cus_1', 'sub_1', 'pro', 'active', null, false, 'subscription.active'
         )`,
        ["wrong-secret-value", userId],
      ),
    ).rejects.toThrow(/unauthorized billing webhook call/);

    await pool.query(
      `select upsert_subscription_from_polar(
         $1, $2, 'cus_1', 'sub_1', 'pro', 'active', null, false, 'subscription.active'
       )`,
      [BILLING_SECRET, userId],
    );

    const subscription = await pool.query<{ plan: string }>(
      "select plan from subscriptions where user_id = $1",
      [userId],
    );

    expect(subscription.rows[0].plan).toBe("pro");

    const config = await pool.query<{ webhook_secret: string }>(
      "select webhook_secret from billing_config where id = true",
    );
    expect(config.rows[0].webhook_secret).toBe("");
  });

  it("너무 짧은 시크릿은 저장 전에 거부한다", async () => {
    await expect(
      pool.query("select set_billing_webhook_secret($1)", ["short"]),
    ).rejects.toThrow(/at least 16 characters/);
  });
});

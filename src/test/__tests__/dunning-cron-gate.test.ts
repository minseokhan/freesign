// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser } from "../pg";

// 0034: create_dunning_drafts_for_overdue 의 Pro 게이트 + 배치 상한.
// 이 RPC는 크론 시크릿 게이트만 통과하면 RLS 없이 모든 테넌트의 연체 인보이스를 후보로 만들고,
// sweep이 후보마다 Claude를 호출한다. 플랜 게이트·상한이 없으면 무료 사용자의 연체 건수만큼
// 외부 API 비용이 무제한으로 발생한다.
describe("create_dunning_drafts_for_overdue 플랜 게이트·배치 상한 (0034)", () => {
  let pool: Pool;

  const CRON_SECRET = "test-cron-secret";
  // cron-tenant-scope.test.ts와 공유하는 스윕 직렬화 키(같은 DB를 동시에 훑는다).
  const SWEEP_LOCK_KEY = 918273;
  const PER_USER_CAP = 20;
  const PER_RUN_CAP = 200;

  type Candidate = { user_id: string; invoice_id: string };

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    // 0041: 시크릿은 평문이 아니라 sha256 해시로 저장한다(set_cron_secret 헬퍼).
    await pool.query("select set_cron_secret($1)", [CRON_SECRET]);
  });

  afterAll(async () => {
    await pool.end();
  });

  // 각 테스트는 자기 유저만 보므로, 다른 테스트가 만든 후보와 섞이지 않도록
  // 매번 초안을 비우고 결과를 대상 유저로 필터링한다.
  beforeEach(async () => {
    await pool.query("delete from dunning_reminders");
  });

  async function seedOwner(plan: "free" | "pro", periodEnd: string | null = null) {
    const userId = await createUser(pool);

    if (plan === "pro") {
      await pool.query(
        `insert into subscriptions (user_id, plan, status, current_period_end)
         values ($1, 'pro', 'active', $2)`,
        [userId, periodEnd],
      );
    }

    const client = await pool.query<{ id: string }>(
      "insert into clients (user_id, name, channel, contact_email) values ($1, '연체 고객', 'direct', 'client@example.test') returning id",
      [userId],
    );

    return { userId, clientId: client.rows[0].id };
  }

  async function seedOverdueInvoices(userId: string, clientId: string, count: number) {
    await pool.query(
      `insert into invoices (
         user_id, client_id, issue_date, due_date, amount,
         withholding_type, withholding_amount, net_amount, payment_status
       )
       select $1, $2, current_date - 40, current_date - 30 + g, 1000000,
              'wt_3_3', 33000, 967000, 'unpaid'
       from generate_series(1, $3) as g`,
      [userId, clientId, count],
    );
  }

  async function runSweep() {
    const client = await pool.connect();

    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock($1)", [SWEEP_LOCK_KEY]);
      const result = await client.query<Candidate>(
        "select user_id, invoice_id from create_dunning_drafts_for_overdue($1, 7)",
        [CRON_SECRET],
      );
      await client.query("commit");

      return result.rows;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  it("free 플랜 소유자의 연체 인보이스는 후보에서 제외한다", async () => {
    const { userId, clientId } = await seedOwner("free");
    await seedOverdueInvoices(userId, clientId, 3);

    const candidates = await runSweep();

    expect(candidates.filter((c) => c.user_id === userId)).toHaveLength(0);
  });

  it("pro 플랜 소유자의 연체 인보이스는 후보에 포함한다", async () => {
    const { userId, clientId } = await seedOwner("pro");
    await seedOverdueInvoices(userId, clientId, 3);

    const candidates = await runSweep();

    expect(candidates.filter((c) => c.user_id === userId)).toHaveLength(3);
  });

  it("구독 기간이 만료된 pro는 free로 취급해 제외한다", async () => {
    const { userId, clientId } = await seedOwner("pro", "2020-01-01T00:00:00Z");
    await seedOverdueInvoices(userId, clientId, 3);

    const candidates = await runSweep();

    expect(candidates.filter((c) => c.user_id === userId)).toHaveLength(0);
  });

  it("revoked 구독은 제외한다", async () => {
    const { userId, clientId } = await seedOwner("pro");
    await pool.query("update subscriptions set status = 'revoked' where user_id = $1", [userId]);
    await seedOverdueInvoices(userId, clientId, 3);

    const candidates = await runSweep();

    expect(candidates.filter((c) => c.user_id === userId)).toHaveLength(0);
  });

  it("사용자당 상한을 넘겨 초안을 만들지 않는다", async () => {
    const { userId, clientId } = await seedOwner("pro");
    await seedOverdueInvoices(userId, clientId, PER_USER_CAP + 5);

    const candidates = await runSweep();

    expect(candidates.filter((c) => c.user_id === userId)).toHaveLength(PER_USER_CAP);
  });

  it("한 번의 실행에서 전체 배치 상한을 넘지 않는다", async () => {
    const owners = 11;

    for (let i = 0; i < owners; i += 1) {
      const { userId, clientId } = await seedOwner("pro");
      await seedOverdueInvoices(userId, clientId, PER_USER_CAP);
    }

    const candidates = await runSweep();

    // owners * PER_USER_CAP = 220 후보가 자격을 갖지만 실행당 상한에서 잘린다.
    expect(candidates.length).toBe(PER_RUN_CAP);
  });

  it("만들어진 초안 수와 반환 행 수가 일치한다(placeholder 유실 없음)", async () => {
    const { userId, clientId } = await seedOwner("pro");
    await seedOverdueInvoices(userId, clientId, 3);

    const candidates = await runSweep();
    const stored = await pool.query<{ n: string }>(
      "select count(*) as n from dunning_reminders where user_id = $1 and status = 'pending_review'",
      [userId],
    );

    expect(Number(stored.rows[0].n)).toBe(candidates.filter((c) => c.user_id === userId).length);
  });
});

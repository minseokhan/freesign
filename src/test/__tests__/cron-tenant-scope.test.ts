// @vitest-environment node
import { inject } from "vitest";
import { Pool, type PoolClient } from "pg";
import { createUser, runAs, withRollback } from "../pg";

// 0038 회귀 테스트. 크론 DEFINER RPC는 RLS를 우회하므로 조인 자체에 테넌트 일치가 없으면
// 남의 클라이언트·계약 정보가 공격자 소유 산출물(독촉 초안·반복 인보이스)로 흘러든다.
// 근본 원인인 "남의 FK 참조"도 정책 WITH CHECK에서 함께 막는다.
//
// 스윕 테스트는 하나의 트랜잭션 안에서 픽스처 생성 → 스윕 호출 → 롤백으로 돌린다.
// 스윕은 전 테넌트를 훑기 때문에, 커밋된 픽스처를 쓰면 같은 DB를 공유하는 다른 테스트
// 파일의 스윕이 내 후보를 먼저 채가 결과가 흔들린다(미커밋 행은 남에게 보이지 않는다).
describe("크론 RPC 테넌트 스코프 · FK 부모 소유권 (0038)", () => {
  let pool: Pool;

  const CRON_SECRET = "test-cron-secret";

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    await pool.query(
      `insert into cron_config (id, cron_secret) values (true, $1)
       on conflict (id) do update set cron_secret = excluded.cron_secret`,
      [CRON_SECRET],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  // 스윕은 전 테넌트를 훑으므로, 같은 DB를 쓰는 다른 테스트 파일의 스윕과 동시에 돌면
  // 같은 인보이스에 대해 초안을 두 번 만들려다 unique 인덱스에서 충돌한다.
  // 스윕 호출끼리만 직렬화하는 advisory lock(같은 키를 dunning-cron-gate도 쓴다).
  const SWEEP_LOCK_KEY = 918273;

  async function seedProOwner(client: PoolClient) {
    const user = await client.query<{ id: string }>(
      "insert into auth.users (email) values ($1) returning id",
      [`tenant-scope-${crypto.randomUUID()}@example.test`],
    );
    const userId = user.rows[0].id;

    await client.query(
      `insert into subscriptions (user_id, plan, status) values ($1, 'pro', 'active')`,
      [userId],
    );

    const clientRow = await client.query<{ id: string }>(
      `insert into clients (user_id, name, channel, contact_email)
       values ($1, '고객', 'direct', 'client@example.test') returning id`,
      [userId],
    );

    return { userId, clientId: clientRow.rows[0].id };
  }

  async function insertContract(client: PoolClient, userId: string, clientId: string) {
    const result = await client.query<{ id: string }>(
      `insert into contracts (user_id, client_id, title, scope, amount, start_date, end_date, clauses)
       values ($1, $2, '피해자 계약', '범위', 1000000, '2026-01-01', '2026-02-01',
               '[{"title":"제1조","body":"본문"}]'::jsonb)
       returning id`,
      [userId, clientId],
    );

    return result.rows[0].id;
  }

  // 정책을 우회해 "이미 만들어진 나쁜 행"을 심는다(정책 도입 전 데이터 · 다른 경로 가정).
  async function insertOverdueInvoice(
    client: PoolClient,
    userId: string,
    clientId: string,
    contractId: string | null = null,
  ) {
    await client.query(
      `insert into invoices (
         user_id, client_id, contract_id, issue_date, due_date, amount,
         withholding_type, withholding_amount, net_amount, payment_status
       )
       values ($1, $2, $3, current_date - 400, current_date - 390, 1000000,
               'wt_3_3', 33000, 967000, 'unpaid')`,
      [userId, clientId, contractId],
    );
  }

  type DunningCandidate = {
    user_id: string;
    client_name: string;
    contract_title: string;
  };

  async function runDunningSweep(client: PoolClient, userId: string) {
    await client.query("select pg_advisory_xact_lock($1)", [SWEEP_LOCK_KEY]);
    const result = await client.query<DunningCandidate>(
      "select user_id, client_name, contract_title from create_dunning_drafts_for_overdue($1, 7)",
      [CRON_SECRET],
    );

    return result.rows.filter((row) => row.user_id === userId);
  }

  it("남의 클라이언트를 참조하는 인보이스는 독촉 후보에서 빠진다", async () => {
    await withRollback(pool, async (client) => {
      const victim = await seedProOwner(client);
      const attacker = await seedProOwner(client);

      await insertOverdueInvoice(client, attacker.userId, victim.clientId);

      expect(await runDunningSweep(client, attacker.userId)).toHaveLength(0);
    });
  });

  it("남의 계약을 참조해도 계약 제목이 새어 나가지 않는다", async () => {
    await withRollback(pool, async (client) => {
      const victim = await seedProOwner(client);
      const attacker = await seedProOwner(client);
      const victimContract = await insertContract(client, victim.userId, victim.clientId);

      await insertOverdueInvoice(
        client,
        attacker.userId,
        attacker.clientId,
        victimContract,
      );

      const mine = await runDunningSweep(client, attacker.userId);

      expect(mine).toHaveLength(1);
      expect(mine[0].contract_title).toBe("(제목 없음)");
    });
  });

  it("자기 클라이언트를 참조하는 인보이스는 그대로 후보가 된다(정상 경로 회귀)", async () => {
    await withRollback(pool, async (client) => {
      const owner = await seedProOwner(client);
      await insertOverdueInvoice(client, owner.userId, owner.clientId);

      const candidates = await runDunningSweep(client, owner.userId);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].client_name).toBe("고객");
    });
  });

  async function insertRecurringSchedule(
    client: PoolClient,
    userId: string,
    clientId: string,
  ) {
    await client.query(
      `insert into recurring_invoices (
         user_id, client_id, amount, withholding_type, withholding_amount, net_amount,
         interval_kind, next_run_at
       )
       values ($1, $2, 1000000, 'wt_3_3', 33000, 967000, 'monthly', current_date)`,
      [userId, clientId],
    );
  }

  async function runRecurringSweep(client: PoolClient, userId: string) {
    await client.query("select pg_advisory_xact_lock($1)", [SWEEP_LOCK_KEY]);
    const result = await client.query<{ user_id: string }>(
      "select user_id from generate_due_recurring_invoices($1)",
      [CRON_SECRET],
    );

    return result.rows.filter((row) => row.user_id === userId);
  }

  it("남의 클라이언트를 참조하는 반복 스케줄은 인보이스를 만들지 않는다", async () => {
    await withRollback(pool, async (client) => {
      const victim = await seedProOwner(client);
      const attacker = await seedProOwner(client);

      await insertRecurringSchedule(client, attacker.userId, victim.clientId);

      expect(await runRecurringSweep(client, attacker.userId)).toHaveLength(0);
    });
  });

  it("자기 클라이언트를 참조하는 반복 스케줄은 그대로 생성된다(정상 경로 회귀)", async () => {
    await withRollback(pool, async (client) => {
      const owner = await seedProOwner(client);

      await insertRecurringSchedule(client, owner.userId, owner.clientId);

      expect(await runRecurringSweep(client, owner.userId)).toHaveLength(1);
    });
  });

  // 정책 테스트는 스윕과 무관하므로 커밋된 픽스처 + runAs(authenticated)로 검증한다.
  async function seedPolicyOwner() {
    const userId = await createUser(pool);
    const clientRow = await pool.query<{ id: string }>(
      `insert into clients (user_id, name, channel) values ($1, '고객', 'direct') returning id`,
      [userId],
    );

    return { userId, clientId: clientRow.rows[0].id };
  }

  it("남의 클라이언트를 참조하는 인보이스는 애초에 INSERT되지 않는다", async () => {
    const victim = await seedPolicyOwner();
    const attacker = await seedPolicyOwner();

    await expect(
      runAs(
        pool,
        attacker.userId,
        `insert into invoices (
           user_id, client_id, issue_date, due_date, amount,
           withholding_type, withholding_amount, net_amount, payment_status
         )
         values ($1, $2, current_date, current_date + 14, 1000000,
                 'wt_3_3', 33000, 967000, 'unpaid')`,
        [attacker.userId, victim.clientId],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("남의 계약을 참조하는 인보이스도 INSERT되지 않는다", async () => {
    const victim = await seedPolicyOwner();
    const attacker = await seedPolicyOwner();
    const victimContract = await pool
      .query<{ id: string }>(
        `insert into contracts (user_id, client_id, title, scope, amount, start_date, end_date, clauses)
         values ($1, $2, '피해자 계약', '범위', 1000000, '2026-01-01', '2026-02-01',
                 '[{"title":"제1조","body":"본문"}]'::jsonb)
         returning id`,
        [victim.userId, victim.clientId],
      )
      .then((result) => result.rows[0].id);

    await expect(
      runAs(
        pool,
        attacker.userId,
        `insert into invoices (
           user_id, client_id, contract_id, issue_date, due_date, amount,
           withholding_type, withholding_amount, net_amount, payment_status
         )
         values ($1, $2, $3, current_date, current_date + 14, 1000000,
                 'wt_3_3', 33000, 967000, 'unpaid')`,
        [attacker.userId, attacker.clientId, victimContract],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("자기 클라이언트·계약 참조는 정상적으로 INSERT된다(정상 경로 회귀)", async () => {
    const owner = await seedPolicyOwner();
    const contractId = await pool
      .query<{ id: string }>(
        `insert into contracts (user_id, client_id, title, scope, amount, start_date, end_date, clauses)
         values ($1, $2, '내 계약', '범위', 1000000, '2026-01-01', '2026-02-01',
                 '[{"title":"제1조","body":"본문"}]'::jsonb)
         returning id`,
        [owner.userId, owner.clientId],
      )
      .then((result) => result.rows[0].id);

    const result = await runAs<{ id: string }>(
      pool,
      owner.userId,
      `insert into invoices (
         user_id, client_id, contract_id, issue_date, due_date, amount,
         withholding_type, withholding_amount, net_amount, payment_status
       )
       values ($1, $2, $3, current_date, current_date + 14, 1000000,
               'wt_3_3', 33000, 967000, 'unpaid')
       returning id`,
      [owner.userId, owner.clientId, contractId],
    );

    expect(result.rows).toHaveLength(1);
  });

  it("남의 클라이언트를 참조하는 반복 스케줄도 INSERT되지 않는다", async () => {
    const victim = await seedPolicyOwner();
    const attacker = await seedPolicyOwner();

    await expect(
      runAs(
        pool,
        attacker.userId,
        `insert into recurring_invoices (
           user_id, client_id, amount, withholding_type, withholding_amount, net_amount,
           interval_kind, next_run_at
         )
         values ($1, $2, 1000000, 'wt_3_3', 33000, 967000, 'monthly', current_date)`,
        [attacker.userId, victim.clientId],
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

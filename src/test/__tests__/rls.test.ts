// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser, runAs, runAsAnon } from "../pg";

describe("RLS policies", () => {
  let pool: Pool;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    userA = await createUser(pool, "rls-a@example.test");
    userB = await createUser(pool, "rls-b@example.test");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("enables RLS and exposes only the intended policy commands", async () => {
    const rlsResult = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `
        select relname, relrowsecurity
        from pg_class
        where relnamespace = 'public'::regnamespace
          and relname in (
            'anon_rate_limit_events',
            'clients',
            'contract_signatures',
            'contracts',
            'invoices',
            'contract_events',
            'invoice_events',
            'profiles',
            'signature_requests'
          )
        order by relname
      `,
    );

    expect(rlsResult.rows).toEqual([
      { relname: "anon_rate_limit_events", relrowsecurity: true },
      { relname: "clients", relrowsecurity: true },
      { relname: "contract_events", relrowsecurity: true },
      { relname: "contract_signatures", relrowsecurity: true },
      { relname: "contracts", relrowsecurity: true },
      { relname: "invoice_events", relrowsecurity: true },
      { relname: "invoices", relrowsecurity: true },
      { relname: "profiles", relrowsecurity: true },
      { relname: "signature_requests", relrowsecurity: true },
    ]);

    const policyResult = await pool.query<{ tablename: string; commands: string[] }>(
      `
        select tablename, array_agg(cmd order by cmd) as commands
        from pg_policies
        where schemaname = 'public'
          and 'authenticated' = any (roles)
        group by tablename
        order by tablename
      `,
    );

    expect(policyResult.rows).toEqual([
      { tablename: "billing_events", commands: ["SELECT"] },
      { tablename: "clients", commands: ["DELETE", "INSERT", "SELECT", "UPDATE"] },
      // 0036: 증거·감사 테이블의 INSERT 정책은 제거됐다(append_*·*_with_event DEFINER RPC 전용).
      { tablename: "contract_events", commands: ["DELETE", "SELECT"] },
      { tablename: "contract_signatures", commands: ["SELECT"] },
      { tablename: "contracts", commands: ["DELETE", "INSERT", "SELECT", "UPDATE"] },
      { tablename: "invoice_events", commands: ["DELETE", "SELECT"] },
      // 0046: 공개 청구서 토큰은 소유자 읽기만 연다. 쓰기는 send_invoice_with_event DEFINER RPC 전용.
      { tablename: "invoice_share_tokens", commands: ["SELECT"] },
      { tablename: "invoices", commands: ["DELETE", "INSERT", "SELECT", "UPDATE"] },
      { tablename: "profiles", commands: ["INSERT", "SELECT", "UPDATE"] },
      // 0038: 부모(client·contract) 소유권 WITH CHECK를 넣으며 `to authenticated`로 재작성됐다.
      // SELECT·DELETE 정책은 0029 원본대로 role 무지정이라 이 목록에 잡히지 않는다.
      { tablename: "recurring_invoices", commands: ["INSERT", "UPDATE"] },
      { tablename: "signature_requests", commands: ["SELECT", "UPDATE"] },
      { tablename: "subscriptions", commands: ["SELECT"] },
      { tablename: "usage_counters", commands: ["SELECT"] },
    ]);
  });

  async function insertClientAs(
    userId: string,
    name = `Client ${crypto.randomUUID()}`,
    isDemo = false,
  ) {
    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        insert into clients (user_id, name, channel, is_demo)
        values ($1, $2, 'direct', $3)
        returning id
      `,
      [userId, name, isDemo],
    );

    return result.rows[0].id;
  }

  async function insertContractAs(userId: string, clientId: string, isDemo = false) {
    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        insert into contracts (
          user_id, client_id, title, scope, amount, start_date, end_date, is_demo
        )
        values (
          $1, $2, 'RLS contract', 'RLS scope', 100000, '2026-07-01', '2026-07-31', $3
        )
        returning id
      `,
      [userId, clientId, isDemo],
    );

    return result.rows[0].id;
  }

  it("allows users to insert and select their own client rows", async () => {
    const clientId = await insertClientAs(userA, "Owned client");

    const result = await runAs<{ id: string; user_id: string }>(
      pool,
      userA,
      "select id, user_id from clients where id = $1",
      [clientId],
    );

    expect(result.rows).toEqual([{ id: clientId, user_id: userA }]);
  });

  it("isolates user-owned client rows between authenticated users", async () => {
    const clientId = await insertClientAs(userA, "Hidden from B");

    const result = await runAs<{ id: string }>(
      pool,
      userB,
      "select id from clients where id = $1",
      [clientId],
    );

    expect(result.rows).toEqual([]);
  });

  it("blocks authenticated users from inserting rows for another user_id", async () => {
    await expect(
      runAs(
        pool,
        userB,
        `
          insert into clients (user_id, name, channel)
          values ($1, 'Spoofed owner', 'direct')
        `,
        [userA],
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it("blocks ownership transfer through user_id updates", async () => {
    const clientId = await insertClientAs(userA, "No transfer");

    await expect(
      runAs(
        pool,
        userA,
        "update clients set user_id = $1 where id = $2",
        [userB, clientId],
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it("keeps non-demo contract events append-only for authenticated users", async () => {
    const clientId = await insertClientAs(userA, "Event client");
    const contractId = await insertContractAs(userA, clientId);
    // 0036: 이벤트 기록은 DEFINER RPC 전용(직접 INSERT 표면 제거).
    const eventResult = await runAs<{ id: string }>(
      pool,
      userA,
      "select append_contract_event($1, 'user', null, 'draft', 'created', '{}'::jsonb) as id",
      [contractId],
    );
    const eventId = eventResult.rows[0].id;

    const updateResult = await runAs(
      pool,
      userA,
      "update contract_events set event_type = 'tampered' where id = $1",
      [eventId],
    );
    expect(updateResult.rowCount).toBe(0);

    const deleteResult = await runAs(
      pool,
      userA,
      "delete from contract_events where id = $1",
      [eventId],
    );
    expect(deleteResult.rowCount).toBe(0);

    const visibleResult = await runAs<{ event_type: string }>(
      pool,
      userA,
      "select event_type from contract_events where id = $1",
      [eventId],
    );
    expect(visibleResult.rows).toEqual([{ event_type: "created" }]);
  });

  it("allows authenticated users to hard-delete only their demo rows", async () => {
    const realClientId = await insertClientAs(userA, "Real client", false);
    const demoClientId = await insertClientAs(userA, "Demo client", true);
    const demoContractId = await insertContractAs(userA, demoClientId, true);
    const demoEventResult = await runAs<{ id: string }>(
      pool,
      userA,
      "select append_contract_event($1, 'user', null, 'signed', 'demo', '{}'::jsonb) as id",
      [demoContractId],
    );

    const blockedRealDelete = await runAs(
      pool,
      userA,
      "delete from clients where id = $1",
      [realClientId],
    );
    expect(blockedRealDelete.rowCount).toBe(0);

    const eventDelete = await runAs(
      pool,
      userA,
      "delete from contract_events where id = $1",
      [demoEventResult.rows[0].id],
    );
    expect(eventDelete.rowCount).toBe(1);

    const contractDelete = await runAs(
      pool,
      userA,
      "delete from contracts where id = $1",
      [demoContractId],
    );
    expect(contractDelete.rowCount).toBe(1);

    const clientDelete = await runAs(
      pool,
      userA,
      "delete from clients where id = $1",
      [demoClientId],
    );
    expect(clientDelete.rowCount).toBe(1);
  });

  async function insertInvoiceAs(
    userId: string,
    contractId: string,
    clientId: string,
  ) {
    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        insert into invoices (
          user_id, contract_id, client_id, amount, issue_date, due_date,
          withholding_type, withholding_amount, net_amount
        )
        values (
          $1, $2, $3, 100000, '2026-07-01', '2026-07-31', 'wt_3_3', 3300, 96700
        )
        returning id
      `,
      [userId, contractId, clientId],
    );

    return result.rows[0].id;
  }

  it("lets an owner hard-delete a contract while preserving its invoices with null contract_id", async () => {
    const clientId = await insertClientAs(userA, "Hard delete client");
    const contractId = await insertContractAs(userA, clientId);
    const invoiceId = await insertInvoiceAs(userA, contractId, clientId);
    await runAs(
      pool,
      userA,
      "select append_contract_event($1, 'user', null, 'draft', 'created', '{}'::jsonb)",
      [contractId],
    );

    const deleteResult = await runAs(
      pool,
      userA,
      "delete from contracts where id = $1",
      [contractId],
    );
    expect(deleteResult.rowCount).toBe(1);

    // 성공기준 2: 인보이스는 그대로 남고 contract_id는 SET NULL 된다.
    const invoiceResult = await runAs<{ id: string; contract_id: string | null }>(
      pool,
      userA,
      "select id, contract_id from invoices where id = $1",
      [invoiceId],
    );
    expect(invoiceResult.rows).toEqual([{ id: invoiceId, contract_id: null }]);

    // 성공기준 3: 계약 이벤트는 cascade로 모두 사라진다.
    const eventResult = await runAs<{ count: string }>(
      pool,
      userA,
      "select count(*)::text as count from contract_events where contract_id = $1",
      [contractId],
    );
    expect(eventResult.rows).toEqual([{ count: "0" }]);
  });

  it("allows an owner to hard-delete a signed contract regardless of status", async () => {
    const clientId = await insertClientAs(userA, "Signed delete client");
    const contractId = await insertContractAs(userA, clientId);
    // 0045 이후 클라이언트는 초안이 아닌 계약을 UPDATE할 수 없다(status 승격도 마찬가지).
    // 여기서 검증하려는 것은 삭제 정책이므로 상태는 superuser로 만들어 둔다.
    await pool.query("update contracts set status = 'signed' where id = $1", [contractId]);

    const deleteResult = await runAs(
      pool,
      userA,
      "delete from contracts where id = $1",
      [contractId],
    );
    expect(deleteResult.rowCount).toBe(1);
  });

  it("blocks a user from hard-deleting another user's contract", async () => {
    const clientId = await insertClientAs(userA, "Foreign delete client");
    const contractId = await insertContractAs(userA, clientId);

    const deleteResult = await runAs(
      pool,
      userB,
      "delete from contracts where id = $1",
      [contractId],
    );
    expect(deleteResult.rowCount).toBe(0);

    const stillThere = await runAs<{ id: string }>(
      pool,
      userA,
      "select id from contracts where id = $1",
      [contractId],
    );
    expect(stillThere.rows).toEqual([{ id: contractId }]);
  });

  it("blocks anonymous reads with no visible rows", async () => {
    const clientId = await insertClientAs(userA, "Anonymous hidden");

    const result = await runAsAnon<{ id: string }>(
      pool,
      "select id from clients where id = $1",
      [clientId],
    );

    expect(result.rows).toEqual([]);
  });
});

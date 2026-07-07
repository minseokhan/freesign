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
            'clients',
            'contracts',
            'invoices',
            'contract_events',
            'invoice_events',
            'profiles'
          )
        order by relname
      `,
    );

    expect(rlsResult.rows).toEqual([
      { relname: "clients", relrowsecurity: true },
      { relname: "contract_events", relrowsecurity: true },
      { relname: "contracts", relrowsecurity: true },
      { relname: "invoice_events", relrowsecurity: true },
      { relname: "invoices", relrowsecurity: true },
      { relname: "profiles", relrowsecurity: true },
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
      { tablename: "clients", commands: ["DELETE", "INSERT", "SELECT", "UPDATE"] },
      { tablename: "contract_events", commands: ["DELETE", "INSERT", "SELECT"] },
      { tablename: "contracts", commands: ["DELETE", "INSERT", "SELECT", "UPDATE"] },
      { tablename: "invoice_events", commands: ["DELETE", "INSERT", "SELECT"] },
      { tablename: "invoices", commands: ["DELETE", "INSERT", "SELECT", "UPDATE"] },
      { tablename: "profiles", commands: ["INSERT", "SELECT", "UPDATE"] },
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
    const eventResult = await runAs<{ id: string }>(
      pool,
      userA,
      `
        insert into contract_events (
          user_id, contract_id, actor, from_status, to_status, event_type
        )
        values ($1, $2, 'user', null, 'draft', 'created')
        returning id
      `,
      [userA, contractId],
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
      `
        insert into contract_events (
          user_id, contract_id, actor, from_status, to_status, event_type
        )
        values ($1, $2, 'user', null, 'signed', 'demo')
        returning id
      `,
      [userA, demoContractId],
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

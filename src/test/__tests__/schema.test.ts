// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser } from "../pg";

describe("database schema migrations", () => {
  let pool: Pool;
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    userId = await createUser(pool, "schema@example.test");

    const clientResult = await pool.query<{ id: string }>(
      `
        insert into clients (user_id, name, channel)
        values ($1, 'Acme Studio', 'direct')
        returning id
      `,
      [userId],
    );
    clientId = clientResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates the expected enums and application tables", async () => {
    const enumResult = await pool.query<{ typname: string }>(
      `
        select typname
        from pg_type
        where typname in ('contract_status', 'withholding_type', 'payment_status')
        order by typname
      `,
    );
    expect(enumResult.rows.map((row) => row.typname)).toEqual([
      "contract_status",
      "payment_status",
      "withholding_type",
    ]);

    const tableResult = await pool.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in (
            'clients',
            'contracts',
            'invoices',
            'contract_events',
            'invoice_events',
            'profiles'
          )
        order by table_name
      `,
    );
    expect(tableResult.rows.map((row) => row.table_name)).toEqual([
      "clients",
      "contract_events",
      "contracts",
      "invoice_events",
      "invoices",
      "profiles",
    ]);
  });

  it("attaches updated_at triggers only to mutable tables", async () => {
    const triggerResult = await pool.query<{ table_name: string }>(
      `
        select event_object_table as table_name
        from information_schema.triggers
        where trigger_schema = 'public'
          and trigger_name in (
            'set_clients_updated_at',
            'set_contracts_updated_at',
            'set_invoices_updated_at',
            'set_profiles_updated_at'
          )
        order by event_object_table
      `,
    );
    expect(triggerResult.rows.map((row) => row.table_name)).toEqual([
      "clients",
      "contracts",
      "invoices",
      "profiles",
    ]);

    const eventColumnResult = await pool.query<{ column_name: string }>(
      `
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name in ('contract_events', 'invoice_events')
          and column_name in ('updated_at', 'deleted_at')
      `,
    );
    expect(eventColumnResult.rows).toEqual([]);
  });

  async function insertContract(overrides: Record<string, unknown> = {}) {
    const values = {
      user_id: userId,
      client_id: clientId,
      title: "Website build",
      scope: "Landing page design and implementation",
      amount: 1_000_000,
      start_date: "2026-07-01",
      end_date: "2026-07-31",
      clauses: [],
      ...overrides,
    };

    return await pool.query(
      `
        insert into contracts (
          user_id, client_id, title, scope, amount, start_date, end_date, clauses
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb
        )
        returning id
      `,
      [
        values.user_id,
        values.client_id,
        values.title,
        values.scope,
        values.amount,
        values.start_date,
        values.end_date,
        JSON.stringify(values.clauses),
      ],
    );
  }

  async function insertInvoice(overrides: Record<string, unknown> = {}) {
    const contractResult = await insertContract({
      title: `Invoice contract ${crypto.randomUUID()}`,
    });
    const contractId = contractResult.rows[0].id;
    const values = {
      user_id: userId,
      contract_id: contractId,
      client_id: clientId,
      amount: 1_000_000,
      issue_date: "2026-07-01",
      due_date: "2026-07-31",
      withholding_type: "wt_3_3",
      withholding_amount: 33_000,
      net_amount: 967_000,
      ...overrides,
    };

    return await pool.query(
      `
        insert into invoices (
          user_id, contract_id, client_id, amount, issue_date, due_date,
          withholding_type, withholding_amount, net_amount
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning id
      `,
      [
        values.user_id,
        values.contract_id,
        values.client_id,
        values.amount,
        values.issue_date,
        values.due_date,
        values.withholding_type,
        values.withholding_amount,
        values.net_amount,
      ],
    );
  }

  it("accepts valid rows for the six application tables", async () => {
    const contractResult = await insertContract();
    const contractId = contractResult.rows[0].id;
    const invoiceResult = await insertInvoice({ contract_id: contractId });
    const invoiceId = invoiceResult.rows[0].id;

    await expect(
      pool.query(
        `
          insert into contract_events (
            user_id, contract_id, actor, from_status, to_status, event_type
          )
          values ($1, $2, 'user', null, 'draft', 'created')
        `,
        [userId, contractId],
      ),
    ).resolves.toBeDefined();

    await expect(
      pool.query(
        `
          insert into invoice_events (
            user_id, invoice_id, actor, from_status, to_status, event_type
          )
          values ($1, $2, 'user', null, 'draft', 'created')
        `,
        [userId, invoiceId],
      ),
    ).resolves.toBeDefined();

    await expect(
      pool.query(
        `
          insert into profiles (user_id, display_name)
          values ($1, 'Schema User')
        `,
        [userId],
      ),
    ).resolves.toBeDefined();
  });

  it("rejects invalid contract amounts", async () => {
    await expect(insertContract({ amount: 0 })).rejects.toThrow();
  });

  it("rejects invalid invoice amounts and withholding snapshots", async () => {
    await expect(insertInvoice({ amount: 0 })).rejects.toThrow();
    await expect(insertInvoice({ withholding_amount: 1_000_001 })).rejects.toThrow();
    await expect(insertInvoice({ withholding_amount: -1 })).rejects.toThrow();
    await expect(insertInvoice({ net_amount: -1 })).rejects.toThrow();
  });

  it("rejects invoice due dates before issue dates", async () => {
    await expect(
      insertInvoice({ issue_date: "2026-07-31", due_date: "2026-07-01" }),
    ).rejects.toThrow();
  });

  it("rejects enum values outside the contract status set", async () => {
    await expect(
      pool.query(
        `
          insert into contracts (
            user_id, client_id, title, scope, amount, start_date, end_date, status
          )
          values ($1, $2, 'Bad status', 'Scope', 100000, '2026-07-01', '2026-07-31', 'paused')
        `,
        [userId, clientId],
      ),
    ).rejects.toThrow();
  });

  it("rejects channels outside the allowed text set", async () => {
    await expect(
      pool.query(
        `
          insert into clients (user_id, name, channel)
          values ($1, 'TikTok lead', 'tiktok')
        `,
        [userId],
      ),
    ).rejects.toThrow();
  });

  it("rejects contracts for missing clients", async () => {
    await expect(
      insertContract({ client_id: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toThrow();
  });
});

// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";

describe("database indexes", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates the expected lookup and event indexes", async () => {
    const indexResult = await pool.query<{
      tablename: string;
      indexname: string;
      indexdef: string;
    }>(
      `
        select tablename, indexname, lower(indexdef) as indexdef
        from pg_indexes
        where schemaname = 'public'
          and indexname in (
            'idx_clients_active_user_id',
            'idx_contracts_active_user_id',
            'idx_invoices_active_user_id',
            'idx_invoices_unpaid_due_date',
            'idx_contracts_user_client',
            'idx_invoices_user_client',
            'idx_contract_events_contract_created_at',
            'idx_invoice_events_invoice_created_at'
          )
        order by indexname
      `,
    );

    expect(indexResult.rows).toEqual([
      expect.objectContaining({
        tablename: "clients",
        indexname: "idx_clients_active_user_id",
        indexdef: expect.stringContaining("using btree (user_id)"),
      }),
      expect.objectContaining({
        tablename: "contract_events",
        indexname: "idx_contract_events_contract_created_at",
        indexdef: expect.stringContaining("using btree (contract_id, created_at)"),
      }),
      expect.objectContaining({
        tablename: "contracts",
        indexname: "idx_contracts_active_user_id",
        indexdef: expect.stringContaining("using btree (user_id)"),
      }),
      expect.objectContaining({
        tablename: "contracts",
        indexname: "idx_contracts_user_client",
        indexdef: expect.stringContaining("using btree (user_id, client_id)"),
      }),
      expect.objectContaining({
        tablename: "invoice_events",
        indexname: "idx_invoice_events_invoice_created_at",
        indexdef: expect.stringContaining("using btree (invoice_id, created_at)"),
      }),
      expect.objectContaining({
        tablename: "invoices",
        indexname: "idx_invoices_active_user_id",
        indexdef: expect.stringContaining("using btree (user_id)"),
      }),
      expect.objectContaining({
        tablename: "invoices",
        indexname: "idx_invoices_unpaid_due_date",
        indexdef: expect.stringContaining("using btree (user_id, due_date)"),
      }),
      expect.objectContaining({
        tablename: "invoices",
        indexname: "idx_invoices_user_client",
        indexdef: expect.stringContaining("using btree (user_id, client_id)"),
      }),
    ]);
  });

  it("keeps soft-delete and unpaid indexes partial", async () => {
    const partialIndexResult = await pool.query<{
      indexname: string;
      indexdef: string;
    }>(
      `
        select indexname, lower(indexdef) as indexdef
        from pg_indexes
        where schemaname = 'public'
          and indexname in (
            'idx_clients_active_user_id',
            'idx_contracts_active_user_id',
            'idx_invoices_active_user_id',
            'idx_invoices_unpaid_due_date'
          )
        order by indexname
      `,
    );

    expect(partialIndexResult.rows).toEqual([
      {
        indexname: "idx_clients_active_user_id",
        indexdef: expect.stringContaining("where (deleted_at is null)"),
      },
      {
        indexname: "idx_contracts_active_user_id",
        indexdef: expect.stringContaining("where (deleted_at is null)"),
      },
      {
        indexname: "idx_invoices_active_user_id",
        indexdef: expect.stringContaining("where (deleted_at is null)"),
      },
      {
        indexname: "idx_invoices_unpaid_due_date",
        indexdef: expect.stringContaining("where (payment_status = 'unpaid'::payment_status)"),
      },
    ]);
  });
});

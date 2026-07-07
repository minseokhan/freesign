// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser, runAs } from "../pg";

describe("dashboard metrics functions", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertClient(userId: string, name: string, channel: string) {
    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        insert into clients (user_id, name, channel)
        values ($1, $2, $3)
        returning id
      `,
      [userId, name, channel],
    );

    return result.rows[0].id;
  }

  async function insertContract(userId: string, clientId: string) {
    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        insert into contracts (
          user_id, client_id, title, scope, amount, start_date, end_date
        )
        values (
          $1, $2, 'Dashboard contract', 'Dashboard scope', 1000000, '2026-07-01', '2026-07-31'
        )
        returning id
      `,
      [userId, clientId],
    );

    return result.rows[0].id;
  }

  async function insertInvoice(
    userId: string,
    clientId: string,
    overrides: {
      amount?: number;
      netAmount?: number;
      paymentStatus?: "draft" | "unpaid" | "paid";
      paidAtSql?: string;
      deleted?: boolean;
    },
  ) {
    const contractId = await insertContract(userId, clientId);

    await runAs(
      pool,
      userId,
      `
        insert into invoices (
          user_id, contract_id, client_id, amount, issue_date, due_date,
          withholding_type, withholding_amount, net_amount, payment_status, paid_at, deleted_at
        )
        values (
          $1, $2, $3, $4, '2026-07-01', '2026-07-31',
          'wt_3_3', $5, $6, $7, ${overrides.paidAtSql ?? "null"}, $8
        )
      `,
      [
        userId,
        contractId,
        clientId,
        overrides.amount ?? overrides.netAmount ?? 100_000,
        (overrides.amount ?? overrides.netAmount ?? 100_000) - (overrides.netAmount ?? 100_000),
        overrides.netAmount ?? overrides.amount ?? 100_000,
        overrides.paymentStatus ?? "draft",
        overrides.deleted ? new Date().toISOString() : null,
      ],
    );
  }

  it("returns outstanding and current-month revenue using RLS, soft-delete filters, and KST month boundaries", async () => {
    const userA = await createUser(pool, "dashboard-totals-a@example.test");
    const userB = await createUser(pool, "dashboard-totals-b@example.test");
    const directClientId = await insertClient(userA, "Direct Client", "direct");
    const linkedinClientId = await insertClient(userA, "LinkedIn Client", "linkedin");
    const userBClientId = await insertClient(userB, "Hidden Client", "youtube");

    await insertInvoice(userA, directClientId, {
      amount: 1_000_000,
      netAmount: 900_000,
      paymentStatus: "unpaid",
    });
    await insertInvoice(userA, directClientId, {
      amount: 300_000,
      netAmount: 270_000,
      paymentStatus: "unpaid",
      deleted: true,
    });
    await insertInvoice(userA, directClientId, {
      amount: 500_000,
      netAmount: 450_000,
      paymentStatus: "paid",
      paidAtSql:
        "(date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') + interval '30 minutes'",
    });
    await insertInvoice(userA, linkedinClientId, {
      amount: 600_000,
      netAmount: 540_000,
      paymentStatus: "paid",
      paidAtSql:
        "(date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') - interval '1 minute'",
    });
    await insertInvoice(userB, userBClientId, {
      amount: 9_000_000,
      netAmount: 8_100_000,
      paymentStatus: "unpaid",
    });

    const result = await runAs<{ outstanding_amount: string; monthly_revenue: string }>(
      pool,
      userA,
      "select * from get_dashboard_totals()",
    );

    expect(result.rows).toEqual([
      { outstanding_amount: "1000000", monthly_revenue: "450000" },
    ]);
  });

  it("groups paid revenue by client channel and excludes soft-deleted or non-paid invoices", async () => {
    const userA = await createUser(pool, "dashboard-channel-a@example.test");
    const userB = await createUser(pool, "dashboard-channel-b@example.test");
    const directClientId = await insertClient(userA, "Direct Client", "direct");
    const linkedinClientId = await insertClient(userA, "LinkedIn Client", "linkedin");
    const userBClientId = await insertClient(userB, "Hidden Client", "youtube");

    await insertInvoice(userA, directClientId, {
      netAmount: 100_000,
      paymentStatus: "paid",
      paidAtSql: "now()",
    });
    await insertInvoice(userA, directClientId, {
      netAmount: 50_000,
      paymentStatus: "paid",
      paidAtSql: "now()",
      deleted: true,
    });
    await insertInvoice(userA, linkedinClientId, {
      netAmount: 300_000,
      paymentStatus: "paid",
      paidAtSql: "now()",
    });
    await insertInvoice(userA, linkedinClientId, {
      netAmount: 400_000,
      paymentStatus: "unpaid",
    });
    await insertInvoice(userB, userBClientId, {
      netAmount: 900_000,
      paymentStatus: "paid",
      paidAtSql: "now()",
    });

    const result = await runAs<{ channel: string; revenue: string }>(
      pool,
      userA,
      "select * from get_dashboard_channel_revenue() order by channel",
    );

    expect(result.rows).toEqual([
      { channel: "direct", revenue: "100000" },
      { channel: "linkedin", revenue: "300000" },
    ]);
  });

  it("groups report revenue by client channel for the selected KST paid year", async () => {
    const userA = await createUser(pool, "report-channel-a@example.test");
    const userB = await createUser(pool, "report-channel-b@example.test");
    const directClientId = await insertClient(userA, "Direct Client", "direct");
    const linkedinClientId = await insertClient(userA, "LinkedIn Client", "linkedin");
    const userBClientId = await insertClient(userB, "Hidden Client", "youtube");

    await insertInvoice(userA, directClientId, {
      netAmount: 100_000,
      paymentStatus: "paid",
      paidAtSql: "'2025-12-31 15:30:00+00'::timestamptz",
    });
    await insertInvoice(userA, directClientId, {
      netAmount: 200_000,
      paymentStatus: "paid",
      paidAtSql: "'2026-06-01 00:00:00+00'::timestamptz",
    });
    await insertInvoice(userA, linkedinClientId, {
      netAmount: 300_000,
      paymentStatus: "paid",
      paidAtSql: "'2026-12-31 14:59:59+00'::timestamptz",
    });
    await insertInvoice(userA, linkedinClientId, {
      netAmount: 400_000,
      paymentStatus: "paid",
      paidAtSql: "'2026-12-31 15:00:00+00'::timestamptz",
    });
    await insertInvoice(userA, directClientId, {
      netAmount: 500_000,
      paymentStatus: "unpaid",
    });
    await insertInvoice(userA, directClientId, {
      netAmount: 600_000,
      paymentStatus: "paid",
      paidAtSql: "'2026-07-01 00:00:00+00'::timestamptz",
      deleted: true,
    });
    await insertInvoice(userB, userBClientId, {
      netAmount: 900_000,
      paymentStatus: "paid",
      paidAtSql: "'2026-07-01 00:00:00+00'::timestamptz",
    });

    const result = await runAs<{
      channel: string;
      revenue: string;
      total_revenue: string;
    }>(
      pool,
      userA,
      "select * from get_report_channel_revenue(2026) order by channel",
    );

    expect(result.rows).toEqual([
      { channel: "direct", revenue: "300000", total_revenue: "600000" },
      { channel: "linkedin", revenue: "300000", total_revenue: "600000" },
    ]);
  });

  it("declares dashboard functions as security invoker", async () => {
    const result = await pool.query<{ proname: string; prosecdef: boolean }>(
      `
        select proname, prosecdef
        from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in (
            'get_dashboard_totals',
            'get_dashboard_channel_revenue',
            'get_report_channel_revenue'
          )
        order by proname
      `,
    );

    expect(result.rows).toEqual([
      { proname: "get_dashboard_channel_revenue", prosecdef: false },
      { proname: "get_dashboard_totals", prosecdef: false },
      { proname: "get_report_channel_revenue", prosecdef: false },
    ]);
  });
});

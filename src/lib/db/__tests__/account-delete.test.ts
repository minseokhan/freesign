// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";

import { createUser, runAs, runAsAnon } from "@/test/pg";

/**
 * 계정 삭제(0047 cascade 정비 + 0048 delete_own_account)를 실제 Postgres에 걸고 검증한다.
 * 모킹으로는 FK 삭제 규칙(RESTRICT/NO ACTION/CASCADE)의 상호작용을 잡을 수 없다 —
 * 이 경로에서 실제로 문제가 됐던 것이 정확히 그 부분이다.
 */
describe("delete_own_account", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
  });

  afterAll(async () => {
    await pool.end();
  });

  /** 도메인 전 영역에 행을 하나씩 심는다. 반환값은 소유자 id. */
  async function seedUser(email: string) {
    const userId = await createUser(pool, email);

    await pool.query(
      `insert into profiles (user_id, display_name) values ($1, '테스트')`,
      [userId],
    );

    const client = await pool.query<{ id: string }>(
      `insert into clients (user_id, name, channel, contact_email)
       values ($1, '김클라', 'direct', 'client@example.test') returning id`,
      [userId],
    );
    const clientId = client.rows[0].id;

    const contract = await pool.query<{ id: string }>(
      `insert into contracts (user_id, client_id, title, scope, amount, start_date, end_date, doc_hash)
       values ($1, $2, '용역계약', '범위', 1000000, '2026-01-01', '2026-02-01', $3) returning id`,
      [userId, clientId, "a".repeat(64)],
    );
    const contractId = contract.rows[0].id;

    const invoice = await pool.query<{ id: string }>(
      `insert into invoices (user_id, contract_id, client_id, amount, issue_date, due_date,
                             withholding_type, withholding_amount, net_amount)
       values ($1, $2, $3, 1000000, '2026-01-05', '2026-02-05', 'wt_3_3', 33000, 967000) returning id`,
      [userId, contractId, clientId],
    );
    const invoiceId = invoice.rows[0].id;

    await pool.query(
      `insert into contract_events (user_id, contract_id, actor, to_status, event_type)
       values ($1, $2, $3, 'draft', 'contract.created')`,
      [userId, contractId, userId],
    );
    await pool.query(
      `insert into invoice_events (user_id, invoice_id, actor, to_status, event_type)
       values ($1, $2, $3, 'draft', 'invoice.created')`,
      [userId, invoiceId, userId],
    );

    const request = await pool.query<{ id: string }>(
      `insert into signature_requests (user_id, contract_id, token_hash, recipient_email,
                                       frozen_doc_hash, expires_at)
       values ($1, $2, $3, 'client@example.test', $4, now() + interval '14 days') returning id`,
      [userId, contractId, `${userId}-token-hash`, "b".repeat(64)],
    );

    await pool.query(
      `insert into contract_signatures (user_id, contract_id, request_id, party, signer_email,
                                        signature_image_data, doc_hash)
       values ($1, $2, $3, 'owner', 'me@example.test', 'BASE64', $4)`,
      [userId, contractId, request.rows[0].id, "c".repeat(64)],
    );

    return { userId, clientId, contractId, invoiceId };
  }

  async function countOwnedRows(userId: string) {
    const tables = [
      "profiles",
      "clients",
      "contracts",
      "invoices",
      "contract_events",
      "invoice_events",
      "signature_requests",
      "contract_signatures",
    ];
    const counts: Record<string, number> = {};

    for (const table of tables) {
      const result = await pool.query<{ count: string }>(
        `select count(*)::text as count from ${table} where user_id = $1`,
        [userId],
      );
      counts[table] = Number(result.rows[0].count);
    }

    return counts;
  }

  it("[0047] auth.users를 참조하는 FK 중 NO ACTION이 하나도 남아 있지 않다", async () => {
    const result = await pool.query<{ table_name: string; conname: string }>(`
      select rel.relname as table_name, con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      join pg_class frel on frel.oid = con.confrelid
      join pg_namespace fnsp on fnsp.oid = frel.relnamespace
      where con.contype = 'f'
        and nsp.nspname = 'public'
        and fnsp.nspname = 'auth'
        and frel.relname = 'users'
        and con.confdeltype = 'a'
    `);

    // 새로 만든 테이블에 on delete cascade를 빠뜨리면 여기서 잡힌다.
    expect(result.rows).toEqual([]);
  });

  it("[0048] 보존 테이블은 RLS를 켜고 정책을 하나도 두지 않는다", async () => {
    const rls = await pool.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class
       where relname = 'billing_records_retained' and relnamespace = 'public'::regnamespace`,
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);

    // 정책이 0건 = PostgREST로는 anon·authenticated 누구도 읽고 쓸 수 없다.
    const policies = await pool.query(
      `select 1 from pg_policies
       where schemaname = 'public' and tablename = 'billing_records_retained'`,
    );
    expect(policies.rowCount).toBe(0);
  });

  it("본인 데이터를 전부 지우고 다른 사용자 데이터는 건드리지 않는다", async () => {
    const victim = await seedUser("delete-me@example.test");
    const bystander = await seedUser("keep-me@example.test");

    await runAs(pool, victim.userId, "select delete_own_account()");

    expect(await countOwnedRows(victim.userId)).toEqual({
      profiles: 0,
      clients: 0,
      contracts: 0,
      invoices: 0,
      contract_events: 0,
      invoice_events: 0,
      signature_requests: 0,
      contract_signatures: 0,
    });

    const remaining = await pool.query(
      "select 1 from auth.users where id = $1",
      [victim.userId],
    );
    expect(remaining.rowCount).toBe(0);

    // 옆 사용자는 무손상이어야 한다 — cascade 범위가 넓게 잡히면 여기서 깨진다.
    const bystanderCounts = await countOwnedRows(bystander.userId);
    for (const [table, count] of Object.entries(bystanderCounts)) {
      expect({ table, count }).toEqual({ table, count: 1 });
    }
  });

  it("결제 기록만 개인 식별자 없이 익명 보존한다", async () => {
    const { userId } = await seedUser("billing@example.test");

    await pool.query(
      `insert into subscriptions (user_id, plan, status, polar_customer_id, polar_subscription_id)
       values ($1, 'free', 'revoked', 'cus_123', 'sub_123')`,
      [userId],
    );
    await pool.query(
      `insert into billing_events (user_id, polar_subscription_id, event_type, status)
       values ($1, 'sub_123', 'subscription.created', 'active')`,
      [userId],
    );

    await runAs(pool, userId, "select delete_own_account()");

    const retained = await pool.query<{
      polar_customer_id: string;
      polar_subscription_id: string;
      event_type: string;
    }>(
      `select polar_customer_id, polar_subscription_id, event_type
       from billing_records_retained where polar_subscription_id = 'sub_123'`,
    );

    expect(retained.rowCount).toBe(1);
    expect(retained.rows[0].polar_customer_id).toBe("cus_123");
    expect(retained.rows[0].event_type).toBe("subscription.created");

    // 원본 결제 이벤트는 계정과 함께 사라진다.
    const events = await pool.query(
      "select 1 from billing_events where user_id = $1",
      [userId],
    );
    expect(events.rowCount).toBe(0);

    // 보존 테이블에 사용자를 식별할 컬럼이 아예 없어야 한다.
    const columns = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'billing_records_retained'`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain("user_id");
  });

  it("활성 구독이 남아 있으면 거부하고 아무것도 지우지 않는다", async () => {
    const { userId } = await seedUser("subscribed@example.test");

    await pool.query(
      `insert into subscriptions (user_id, plan, status) values ($1, 'pro', 'active')`,
      [userId],
    );

    await expect(
      runAs(pool, userId, "select delete_own_account()"),
    ).rejects.toThrow(/active_subscription/);

    const counts = await countOwnedRows(userId);
    for (const [table, count] of Object.entries(counts)) {
      expect({ table, count }).toEqual({ table, count: 1 });
    }
  });

  it("세션이 없으면 거부한다", async () => {
    await expect(
      runAsAnon(pool, "select delete_own_account()"),
    ).rejects.toThrow();
  });
});

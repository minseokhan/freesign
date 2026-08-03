import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export type PgTestDatabase = {
  connectionString: string;
  pool: Pool;
  stop: () => Promise<void>;
};

const TEST_DB_USER = "postgres";
const TEST_DB_PASSWORD = "postgres";
const TEST_DB_NAME = "postgres";

async function findOpenPort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (typeof address === "object" && address !== null) {
        const { port } = address;
        server.close(() => resolve(port));
        return;
      }

      server.close(() => reject(new Error("Could not allocate a Postgres test port.")));
    });
  });
}

export async function startPgTestDatabase(): Promise<PgTestDatabase> {
  const databaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "maedeup-pg-"));
  const port = await findOpenPort();
  const embedded = new EmbeddedPostgres({
    databaseDir,
    user: TEST_DB_USER,
    password: TEST_DB_PASSWORD,
    port,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });

  await embedded.initialise();
  await embedded.start();

  const connectionString = `postgres://${TEST_DB_USER}:${TEST_DB_PASSWORD}@127.0.0.1:${port}/${TEST_DB_NAME}`;
  const pool = new Pool({ connectionString });

  return {
    connectionString,
    pool,
    stop: async () => {
      await pool.end();
      await embedded.stop();
    },
  };
}

export async function bootstrapSupabase(pool: Pool) {
  await pool.query(`
    create schema if not exists auth;

    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text
    );

    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
    $$;

    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;

      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;

      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      else
        alter role service_role bypassrls;
      end if;
    end
    $$;

    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
}

export async function applyMigrations(pool: Pool, dir = "supabase/migrations") {
  const migrationDir = path.resolve(process.cwd(), dir);
  let entries: string[];

  try {
    entries = await fs.readdir(migrationDir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  const migrationFiles = entries.filter((entry) => entry.endsWith(".sql")).sort();

  for (const migrationFile of migrationFiles) {
    const migrationSql = await fs.readFile(path.join(migrationDir, migrationFile), "utf8");
    await pool.query(migrationSql);
  }
}

export async function grantSupabaseRoles(pool: Pool) {
  await pool.query(`
    grant usage on schema public to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant usage, select on all sequences in schema public to anon, authenticated;
  `);
}

export async function createUser(pool: Pool, email = `user-${crypto.randomUUID()}@example.test`) {
  const result = await pool.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );

  return result.rows[0].id;
}

export async function runAs<T extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    // RLS tests must run as authenticated/anon, not as postgres. Table owners
    // and superusers bypass RLS, which would make policy tests meaningless.
    await client.query("set local role authenticated");
    await client.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::uuid)::text, true)",
      [userId],
    );
    const result = await client.query<T>(sql, params);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function runAsAnon<T extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    // RLS tests must run as authenticated/anon, not as postgres. Table owners
    // and superusers bypass RLS, which would make policy tests meaningless.
    await client.query("set local role anon");
    const result = await client.query<T>(sql, params);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function withRollback<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    return await callback(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

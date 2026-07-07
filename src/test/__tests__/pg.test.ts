// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inject } from "vitest";
import { Pool } from "pg";
import { applyMigrations, createUser, runAs } from "../pg";

describe("Postgres test harness", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("emulates Supabase request claims for authenticated queries", async () => {
    const userId = await createUser(pool, "authenticated@example.test");

    const result = await runAs<{ uid: string }>(pool, userId, "select auth.uid() as uid");

    expect(result.rows[0].uid).toBe(userId);
  });

  it("treats a missing or empty migration directory as a no-op", async () => {
    const emptyDir = await mkdtemp(path.join(os.tmpdir(), "freesign-empty-migrations-"));

    await expect(applyMigrations(pool, emptyDir)).resolves.toBeUndefined();
    await expect(applyMigrations(pool, path.join(emptyDir, "missing"))).resolves.toBeUndefined();
  });
});

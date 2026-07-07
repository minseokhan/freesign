import { Pool } from "pg";

import { seedDemo } from "../src/lib/db/seed.ts";

const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
const userId = process.env.SEED_USER_ID;

if (!databaseUrl) {
  throw new Error("DATABASE_URL or SUPABASE_DB_URL is required to run the demo seed.");
}

if (!userId) {
  throw new Error("SEED_USER_ID is required to run the demo seed.");
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  const result = await seedDemo(pool, userId);
  console.log(
    `Seeded demo data for user ${userId}: client=${result.clientId} contract=${result.contractId} invoice=${result.invoiceId}`,
  );
} finally {
  await pool.end();
}

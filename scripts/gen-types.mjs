import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { applyMigrations, bootstrapSupabase, startPgTestDatabase } from "../src/test/pg.ts";

const OUTPUT_FILE = new URL("../src/types/database.ts", import.meta.url);

function runSupabaseGenTypes(dbUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "supabase",
        "gen",
        "types",
        "typescript",
        "--schema",
        "public",
        "--db-url",
        dbUrl,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`supabase gen types exited with code ${code}\n${stdout}\n${stderr}`));
    });
  });
}

const db = await startPgTestDatabase();

try {
  await bootstrapSupabase(db.pool);
  await applyMigrations(db.pool);

  const generatedTypes = await runSupabaseGenTypes(db.connectionString);

  await writeFile(OUTPUT_FILE, generatedTypes);
} finally {
  await db.stop();
}

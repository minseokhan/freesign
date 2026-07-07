import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { PostgresMeta } from "@supabase/postgres-meta";
import { getGeneratorMetadata } from "@supabase/postgres-meta/dist/lib/generators.js";
import { apply as applyTypescriptTemplate } from "@supabase/postgres-meta/dist/server/templates/typescript.js";

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

async function generateTypesWithPostgresMeta(dbUrl) {
  const pgMeta = new PostgresMeta({ connectionString: dbUrl });
  const { data, error } = await getGeneratorMetadata(pgMeta, { includedSchemas: ["public"] });

  if (error) {
    throw new Error(error.formattedError ?? error.message);
  }

  return applyTypescriptTemplate({
    ...data,
    detectOneToOneRelationships: true,
  });
}

function canFallbackToPostgresMeta(error) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("ChildProcess.spawn") &&
    (message.includes("podman") || message.includes("docker"))
  );
}

const db = await startPgTestDatabase();

try {
  await bootstrapSupabase(db.pool);
  await applyMigrations(db.pool);

  let generatedTypes;

  try {
    generatedTypes = await runSupabaseGenTypes(db.connectionString);
  } catch (error) {
    if (!canFallbackToPostgresMeta(error)) {
      throw error;
    }

    generatedTypes = await generateTypesWithPostgresMeta(db.connectionString);
  }

  await writeFile(OUTPUT_FILE, generatedTypes);
} finally {
  await db.stop();
}

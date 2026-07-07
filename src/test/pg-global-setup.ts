import type { TestProject } from "vitest/node";
import {
  applyMigrations,
  bootstrapSupabase,
  grantSupabaseRoles,
  startPgTestDatabase,
} from "./pg";

declare module "vitest" {
  export interface ProvidedContext {
    pgConnectionString: string;
  }
}

export default async function setup(project: TestProject) {
  const database = await startPgTestDatabase();

  await bootstrapSupabase(database.pool);
  await applyMigrations(database.pool);
  await grantSupabaseRoles(database.pool);

  project.provide("pgConnectionString", database.connectionString);

  return async () => {
    await database.stop();
  };
}

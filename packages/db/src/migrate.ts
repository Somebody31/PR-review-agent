import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Apply SQL migrations from packages/db/drizzle.
 * Usage: DATABASE_URL=... pnpm --filter @pr-review/db db:migrate
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.join(here, "..", "drizzle");

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  // Enable pgvector before tables that use vector columns
  await client`CREATE EXTENSION IF NOT EXISTS vector`;

  await migrate(db, { migrationsFolder });
  await client.end({ timeout: 5 });
  console.log("Migrations applied from", migrationsFolder);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
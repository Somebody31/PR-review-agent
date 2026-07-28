import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

let sqlClient: Sql | null = null;
let dbInstance: Database | null = null;

/**
 * Create (or reuse) the shared Drizzle client for this process.
 */
export function getDb(databaseUrl: string): Database {
  if (dbInstance) {
    return dbInstance;
  }

  // max 10 connections is enough for api + worker locally
  sqlClient = postgres(databaseUrl, { max: 10 });
  dbInstance = drizzle(sqlClient, { schema });
  return dbInstance;
}

/**
 * Close the pool (tests / graceful shutdown).
 */
export async function closeDb(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = null;
    dbInstance = null;
  }
}

/**
 * Cheap liveness check used by /health and migrate smoke tests.
 * Returns true only when `SELECT 1` succeeds.
 */
export async function pingDb(databaseUrl: string): Promise<boolean> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await client`SELECT 1 AS ok`;
    return rows.length === 1;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 5 });
  }
}

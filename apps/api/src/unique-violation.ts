/**
 * True when Postgres reports unique_violation (duplicate primary key / unique index).
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  // Drizzle/postgres.js sometimes wraps the driver error, so 23505 may be on cause
  const withCode = error as { code?: string; cause?: { code?: string } };
  if (withCode.code === "23505") {
    return true;
  }
  if (withCode.cause && withCode.cause.code === "23505") {
    return true;
  }
  return false;
}

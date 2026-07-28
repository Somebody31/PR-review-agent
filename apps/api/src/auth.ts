import type { Context } from "hono";

/**
 * Require `Authorization: Bearer <API_AUTH_TOKEN>` on protected REST routes.
 * Returns a Response when auth fails; null when the request is allowed.
 */
export function requireApiAuth(c: Context, apiAuthToken: string): Response | null {
  if (!apiAuthToken || apiAuthToken.length === 0) {
    return c.json(
      { error: "API_AUTH_TOKEN is not configured; REST routes are disabled" },
      503,
    );
  }

  const header = c.req.header("authorization") ?? "";
  const expected = `Bearer ${apiAuthToken}`;

  // Plain string compare is enough for MVP API tokens (not password hashing)
  if (header !== expected) {
    return c.json({ error: "unauthorized" }, 401);
  }

  return null;
}

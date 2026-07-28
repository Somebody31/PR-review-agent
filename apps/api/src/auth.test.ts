import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { requireApiAuth } from "./auth.js";

function makeApp(token: string): Hono {
  const app = new Hono();
  app.get("/protected", (c) => {
    const denied = requireApiAuth(c, token);
    if (denied) {
      return denied;
    }
    return c.json({ ok: true });
  });
  return app;
}

describe("requireApiAuth", () => {
  it("returns 503 when API_AUTH_TOKEN is empty", async () => {
    const app = makeApp("");
    const res = await app.request("/protected");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/API_AUTH_TOKEN/);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const app = makeApp("secret-token");
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer token is wrong", async () => {
    const app = makeApp("secret-token");
    const res = await app.request("/protected", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("allows the request when Bearer token matches", async () => {
    const app = makeApp("secret-token");
    const res = await app.request("/protected", {
      headers: { authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

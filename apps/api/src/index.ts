import { Hono } from "hono";
import { createLogger } from "@pr-review/core";

const logger = createLogger({ name: "api" });

/**
 * Minimal API stub for Phase 0.
 * Health only — webhooks and REST come in later phases.
 */
function createApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({ ok: true, service: "api" });
  });

  return app;
}

const app = createApp();
const port = Number(process.env.PORT ?? "3000");

// Node 22 serves Hono via built-in HTTP (simple stub; can switch to @hono/node-server later)
import { serve } from "@hono/node-server";

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    logger.info({ port: info.port }, "api listening");
  },
);

export { createApp };

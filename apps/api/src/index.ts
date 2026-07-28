import { serve } from "@hono/node-server";
import { createLogger, loadConfig } from "@pr-review/core";
import { createApp } from "./app.js";

const logger = createLogger({ name: "api" });

function main(): void {
  // loadConfig once for listen port; createApp calls it again for routes (cheap parse)
  const config = loadConfig();
  const app = createApp();

  serve(
    {
      fetch: app.fetch,
      port: config.PORT,
    },
    (info: { port: number }): void => {
      logger.info({ port: info.port }, "api listening");
    },
  );
}

main();

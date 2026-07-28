import pino, { type Logger } from "pino";

export type { Logger };

/**
 * Create a structured logger.
 * Pretty multi-line output in development; JSON lines in production.
 */
export function createLogger(options?: {
  name?: string;
  level?: string;
  isProduction?: boolean;
}): Logger {
  const isProduction = options?.isProduction ?? process.env.NODE_ENV === "production";
  const level = options?.level ?? process.env.LOG_LEVEL ?? "info";

  if (isProduction) {
    return pino({
      name: options?.name,
      level,
    });
  }

  // Dev: human-readable logs (pino-pretty is a transport, not mixed into JSON prod logs)
  return pino({
    name: options?.name,
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
      },
    },
  });
}

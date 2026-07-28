import { z } from "zod";

/**
 * App config loaded from environment variables.
 * Required fields fail fast so misconfigured deploys do not start half-broken.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  DEEPSEEK_API_KEY: z.string().optional().default(""),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  LLM_MODEL: z.string().default("deepseek-v4-flash"),

  EMBEDDING_BASE_URL: z.string().default("http://127.0.0.1:8000/v1"),
  EMBEDDING_API_KEY: z.string().default("local"),
  EMBEDDING_MODEL: z.string().default("Qwen/Qwen3-Embedding-0.6B"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),

  GITHUB_APP_ID: z.string().optional().default(""),
  GITHUB_PRIVATE_KEY: z.string().optional().default(""),
  GITHUB_WEBHOOK_SECRET: z.string().optional().default(""),

  API_AUTH_TOKEN: z.string().optional().default(""),

  HITL_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(20),
  // Keep auto-post off until eval baseline exists
  AUTO_POST_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((value) => value === "true" || value === "1"),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Parse and validate process.env.
 * Throws a clear error if required values are missing or invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `${path}: ${issue.message}`;
    });
    const joined = messages.join("\n");
    throw new Error(`Invalid configuration:\n${joined}`);
  }

  return result.data;
}

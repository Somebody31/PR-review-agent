import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

function baseEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://prreview:prreview@localhost:5432/prreview",
    REDIS_URL: "redis://localhost:6379",
  };
}

describe("loadConfig", () => {
  it("loads defaults when optional keys are missing", () => {
    const config = loadConfig(baseEnv());

    expect(config.DATABASE_URL).toContain("postgresql://");
    expect(config.LLM_MODEL).toBe("deepseek-v4-flash");
    expect(config.AUTO_POST_ENABLED).toBe(false);
    expect(config.HITL_CONFIDENCE_THRESHOLD).toBe(0.75);
  });

  it("fails clearly when DATABASE_URL is missing", () => {
    expect(() => {
      loadConfig({
        REDIS_URL: "redis://localhost:6379",
      });
    }).toThrow(/DATABASE_URL/);
  });

  it("fails clearly when REDIS_URL is missing", () => {
    expect(() => {
      loadConfig({
        DATABASE_URL: "postgresql://localhost/prreview",
      });
    }).toThrow(/REDIS_URL/);
  });
});

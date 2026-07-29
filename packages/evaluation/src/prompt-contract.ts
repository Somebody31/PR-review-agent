import { getPrompt } from "@pr-review/agents";
import type { AgentType } from "@pr-review/shared";

/**
 * Required substrings in each specialist system prompt.
 * Breaking a prompt (removing focus language) must fail `pnpm eval`.
 */
const REQUIRED_BY_AGENT: Record<AgentType, string[]> = {
  security: ["security", "injection", "secret", "path traversal", "agentType"],
  quality: ["quality", "error handling", "agentType"],
  tests: ["missing", "test", "agentType"],
  docs: ["docs", "README", "agentType"],
};

export type PromptContractResult = {
  ok: boolean;
  failures: string[];
};

/**
 * Offline check that specialist prompts still carry their focus contracts.
 * Complements fixture detectors so prompt-only regressions fail the gate.
 */
export function checkPromptContracts(): PromptContractResult {
  const failures: string[] = [];
  const agents = Object.keys(REQUIRED_BY_AGENT) as AgentType[];

  for (const agent of agents) {
    let prompt: string;
    try {
      prompt = getPrompt(agent, "v1");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${agent}: failed to load prompt (${message})`);
      continue;
    }

    const required = REQUIRED_BY_AGENT[agent];
    const lower = prompt.toLowerCase();
    for (const phrase of required) {
      if (!lower.includes(phrase.toLowerCase())) {
        failures.push(`${agent}: missing required phrase "${phrase}"`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

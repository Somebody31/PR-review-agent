import { randomUUID } from "node:crypto";
import { z } from "zod";
import { maskSecrets } from "@pr-review/core";
import type { PrContext } from "@pr-review/github";
import { findingSchema, type AgentType, type Finding } from "@pr-review/shared";
import { DEFAULT_LLM_ESTIMATE_USD } from "./budget.js";
import { emitHookEvent, type ReviewHooks } from "./hooks.js";
import { completeStructured, estimateCostUsd } from "./llm.js";
import { getPrompt } from "./prompts.js";
import { withTimeout } from "./timeout.js";

const findingsArraySchema = z.array(findingSchema).max(10);

/** Default max time for one specialist (LLM + parse). */
export const AGENT_TIMEOUT_MS = 60_000;

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type SpecialistResult = {
  findings: Finding[];
  latencyMs: number;
  costUsd: number;
};

/**
 * Run one specialist against PR context and optional retrieved repo context (RAG).
 * Emits agent_start / llm_call / agent_end events when hooks are provided.
 */
export async function runSpecialistAgent(args: {
  agentType: AgentType;
  prContext: PrContext;
  llm: LlmConfig;
  /** Retrieved repository context (RAG). Empty string skips the section. */
  repoContext?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  hooks?: ReviewHooks;
}): Promise<SpecialistResult> {
  const system = getPrompt(args.agentType, "v1");
  const user = buildUserMessage(args.prContext, args.repoContext);
  const timeoutMs = args.timeoutMs ?? AGENT_TIMEOUT_MS;
  const spanId = randomUUID().slice(0, 16);
  const started = Date.now();

  await emitHookEvent(args.hooks, {
    eventType: "agent_start",
    agent: args.agentType,
    spanId,
  });

  try {
    const work = completeStructured({
      apiKey: args.llm.apiKey,
      baseUrl: args.llm.baseUrl,
      model: args.llm.model,
      system,
      user,
      schema: findingsArraySchema,
      fetchImpl: args.fetchImpl,
      checkBudget: args.hooks?.checkBudget,
      budgetEstimateUsd: DEFAULT_LLM_ESTIMATE_USD,
    });

    const result = await withTimeout(work, timeoutMs, `${args.agentType} agent`);
    const costUsd = estimateCostUsd(result.model, result.usage);
    const latencyMs = Date.now() - started;

    // Billable cost lives only on llm_call (agent_end is timing/outcome only)
    await emitHookEvent(args.hooks, {
      eventType: "llm_call",
      agent: args.agentType,
      spanId,
      model: result.model,
      tokensIn: result.usage.tokensIn,
      tokensOut: result.usage.tokensOut,
      costUsd,
      latencyMs: result.latencyMs,
    });

    const normalized: Finding[] = [];
    for (const finding of result.data) {
      // Force the agent type so a confused model cannot spoof another specialist
      normalized.push({
        ...finding,
        agentType: args.agentType,
      });
    }

    await emitHookEvent(args.hooks, {
      eventType: "agent_end",
      agent: args.agentType,
      spanId,
      model: result.model,
      tokensIn: result.usage.tokensIn,
      tokensOut: result.usage.tokensOut,
      latencyMs,
      outcome: "ok",
      payload: { findingCount: normalized.length },
    });

    // tokens/model already on llm_call / agent_end hooks; graph only needs findings/latency/cost
    return {
      findings: normalized,
      latencyMs,
      costUsd,
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    // Events may be stored/queried; never leave raw key-shaped text in payload
    const safeMessage = maskSecrets(message);

    await emitHookEvent(args.hooks, {
      eventType: "agent_end",
      agent: args.agentType,
      spanId,
      latencyMs,
      outcome: "error",
      payload: { error: safeMessage.slice(0, 500) },
    });

    throw error;
  }
}

/**
 * Build the user message with PR title/body, per-file patches, and optional RAG context.
 * Masks secret-shaped substrings so PEM keys / tokens in untrusted PR text are not sent raw.
 * App config secrets (GITHUB_PRIVATE_KEY, webhook secret) are never passed into this path.
 */
export function buildUserMessage(prContext: PrContext, repoContext?: string): string {
  const parts: string[] = [];
  parts.push(`# Pull request`);
  parts.push(`Title: ${prContext.title}`);
  parts.push(`Body: ${prContext.body || "(empty)"}`);
  parts.push(`Repo: ${prContext.owner}/${prContext.repo}`);
  parts.push(`PR: #${prContext.prNumber}`);
  parts.push(`Head: ${prContext.headSha}`);
  parts.push("");
  parts.push(`# Changed files`);

  for (const file of prContext.files) {
    parts.push(`## ${file.path} (${file.status})`);
    if (file.patch) {
      parts.push("```diff");
      parts.push(file.patch);
      parts.push("```");
    } else {
      parts.push("(no patch available)");
    }
    parts.push("");
  }

  if (repoContext && repoContext.trim().length > 0) {
    parts.push(`# Repository context`);
    parts.push(repoContext);
    parts.push("");
  }

  parts.push(`Return JSON findings for agent focus only. Empty array is fine.`);
  // Defense in depth: PR body/diff is untrusted and may paste secrets
  return maskSecrets(parts.join("\n"));
}

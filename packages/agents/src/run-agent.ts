import { z } from "zod";
import type { PrContext } from "@pr-review/github";
import { findingSchema, type AgentType, type Finding } from "@pr-review/shared";
import { completeStructured } from "./llm.js";
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
};

/**
 * Run one specialist against PR context and optional retrieved repo context (RAG).
 */
export async function runSpecialistAgent(args: {
  agentType: AgentType;
  prContext: PrContext;
  llm: LlmConfig;
  /** Retrieved repository context (RAG). Empty string skips the section. */
  repoContext?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<SpecialistResult> {
  const system = getPrompt(args.agentType, "v1");
  const user = buildUserMessage(args.prContext, args.repoContext);
  const timeoutMs = args.timeoutMs ?? AGENT_TIMEOUT_MS;
  const started = Date.now();

  const work = completeStructured({
    apiKey: args.llm.apiKey,
    baseUrl: args.llm.baseUrl,
    model: args.llm.model,
    system,
    user,
    schema: findingsArraySchema,
    fetchImpl: args.fetchImpl,
  });

  const result = await withTimeout(work, timeoutMs, `${args.agentType} agent`);

  const normalized: Finding[] = [];
  for (const finding of result.data) {
    // Force the agent type so a confused model cannot spoof another specialist
    normalized.push({
      ...finding,
      agentType: args.agentType,
    });
  }

  return {
    findings: normalized,
    latencyMs: Date.now() - started,
  };
}

/**
 * Build the user message with PR title/body, per-file patches, and optional RAG context.
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
  return parts.join("\n");
}

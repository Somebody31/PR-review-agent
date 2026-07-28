import { z } from "zod";
import { DEFAULT_LLM_ESTIMATE_USD } from "./budget.js";

export type TokenUsage = {
  tokensIn: number;
  tokensOut: number;
};

export type StructuredLlmResult<T> = {
  data: T;
  usage: TokenUsage;
  model: string;
  latencyMs: number;
};

type ModelRates = {
  inputPerMillion: number;
  outputPerMillion: number;
};

// USD per 1M tokens — update when provider pricing changes
const MODEL_RATES: Record<string, ModelRates> = {
  "deepseek-v4-flash": { inputPerMillion: 0.14, outputPerMillion: 0.28 },
};

const DEFAULT_RATES: ModelRates = {
  inputPerMillion: 0.14,
  outputPerMillion: 0.28,
};

/**
 * Rough chat model cost estimate from token usage.
 */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const rates = MODEL_RATES[model] ?? DEFAULT_RATES;
  const inputCost = (usage.tokensIn / 1_000_000) * rates.inputPerMillion;
  const outputCost = (usage.tokensOut / 1_000_000) * rates.outputPerMillion;
  return inputCost + outputCost;
}

/**
 * Call an OpenAI-compatible chat API and parse JSON into a Zod schema.
 * Retries once when the model returns invalid JSON / schema mismatch.
 * Optional checkBudget runs before each HTTP call (BudgetGuard).
 */
export async function completeStructured<T>(args: {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
  /** Hard-block when daily spend would exceed cap. */
  checkBudget?: (estimateUsd: number) => Promise<void>;
  /** USD estimate passed to checkBudget when tokens are unknown. */
  budgetEstimateUsd?: number;
}): Promise<StructuredLlmResult<T>> {
  const fetchFn = args.fetchImpl ?? fetch;
  const maxTokens = args.maxTokens ?? 4096;
  const budgetEstimateUsd = args.budgetEstimateUsd ?? DEFAULT_LLM_ESTIMATE_USD;

  if (args.checkBudget) {
    await args.checkBudget(budgetEstimateUsd);
  }

  const first = await callOnce({
    fetchFn,
    apiKey: args.apiKey,
    baseUrl: args.baseUrl,
    model: args.model,
    system: args.system,
    user: args.user,
    maxTokens,
  });

  const firstParse = tryParse(args.schema, first.content);
  if (firstParse.ok) {
    return {
      data: firstParse.data,
      usage: first.usage,
      model: args.model,
      latencyMs: first.latencyMs,
    };
  }

  // One repair attempt with the validation error shown to the model
  if (args.checkBudget) {
    await args.checkBudget(budgetEstimateUsd);
  }

  const repairUser =
    args.user +
    "\n\nYour previous JSON was invalid:\n" +
    firstParse.error +
    "\nReturn corrected JSON only.";

  const second = await callOnce({
    fetchFn,
    apiKey: args.apiKey,
    baseUrl: args.baseUrl,
    model: args.model,
    system: args.system,
    user: repairUser,
    maxTokens,
  });

  const secondParse = tryParse(args.schema, second.content);
  if (!secondParse.ok) {
    throw new Error(`LLM structured output failed after retry: ${secondParse.error}`);
  }

  return {
    data: secondParse.data,
    usage: {
      tokensIn: first.usage.tokensIn + second.usage.tokensIn,
      tokensOut: first.usage.tokensOut + second.usage.tokensOut,
    },
    model: args.model,
    latencyMs: first.latencyMs + second.latencyMs,
  };
}

type CallResult = {
  content: string;
  usage: TokenUsage;
  latencyMs: number;
};

async function callOnce(args: {
  fetchFn: typeof fetch;
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<CallResult> {
  const url = args.baseUrl.replace(/\/$/, "") + "/chat/completions";
  const started = Date.now();

  const response = await args.fetchFn(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      response_format: { type: "json_object" },
      max_tokens: args.maxTokens,
      temperature: 0.2,
    }),
  });

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`LLM HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = json.choices?.[0]?.message?.content ?? "";
  const usage: TokenUsage = {
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
  };

  return { content, usage, latencyMs };
}

function tryParse<T>(
  schema: z.ZodType<T>,
  content: string,
): { ok: true; data: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(content) as unknown;
  } catch {
    return { ok: false, error: "response was not valid JSON" };
  }

  // Models sometimes wrap the array as { findings: [...] }
  const unwrapped = unwrapFindingsPayload(raw);
  const parsed = schema.safeParse(unwrapped);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  return { ok: true, data: parsed.data };
}

function unwrapFindingsPayload(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "object" && raw !== null && "findings" in raw) {
    const withFindings = raw as { findings: unknown };
    return withFindings.findings;
  }
  return raw;
}

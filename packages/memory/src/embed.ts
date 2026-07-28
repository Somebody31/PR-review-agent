/** Shared settings for the local OpenAI-compatible embed server. */
export type EmbedConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * Call a local OpenAI-compatible embeddings server (Qwen3 by default).
 */
export async function embedTexts(args: {
  embed: EmbedConfig;
  inputs: string[];
  fetchImpl?: typeof fetch;
}): Promise<number[][]> {
  if (args.inputs.length === 0) {
    return [];
  }

  const fetchFn = args.fetchImpl ?? fetch;
  const url = args.embed.baseUrl.replace(/\/$/, "") + "/embeddings";

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.embed.apiKey}`,
    },
    body: JSON.stringify({
      model: args.embed.model,
      input: args.inputs,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Embedding HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  const json = (await response.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };

  const rows = json.data ?? [];
  // Sort by index so batch order matches inputs
  rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const vectors: number[][] = [];
  for (const row of rows) {
    if (!row.embedding || row.embedding.length === 0) {
      throw new Error("Embedding response missing vector");
    }
    vectors.push(row.embedding);
  }

  if (vectors.length !== args.inputs.length) {
    throw new Error(
      `Embedding count mismatch: expected ${args.inputs.length}, got ${vectors.length}`,
    );
  }

  return vectors;
}

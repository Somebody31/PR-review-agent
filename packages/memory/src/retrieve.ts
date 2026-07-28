import { sql } from "drizzle-orm";
import type { Database } from "@pr-review/db";
import { embedTexts, type EmbedConfig } from "./embed.js";

export type RetrievedChunk = {
  path: string;
  content: string;
  score: number;
};

/**
 * Embed a query and return top-k code chunks for a repo (vector cosine distance).
 */
export async function retrieveContext(args: {
  db: Database;
  repoKey: string;
  queryText: string;
  k?: number;
  embed: EmbedConfig;
  fetchImpl?: typeof fetch;
}): Promise<RetrievedChunk[]> {
  const k = args.k ?? 8;
  const vectors = await embedTexts({
    embed: args.embed,
    inputs: [args.queryText],
    fetchImpl: args.fetchImpl,
  });
  const queryVector = vectors[0];
  if (!queryVector) {
    return [];
  }

  // pgvector cosine distance: smaller is closer. Order by embedding <=> query.
  const vectorLiteral = `[${queryVector.join(",")}]`;
  const rows = await args.db.execute(sql`
    SELECT path, content, (embedding <=> ${vectorLiteral}::vector) AS distance
    FROM code_chunks
    WHERE repo = ${args.repoKey}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${k}
  `);

  return mapDistanceRows(rows);
}

type DistanceRow = {
  path: string;
  content: string;
  distance: number | string;
};

/**
 * Map raw SQL rows from retrieveContext into scored chunks.
 */
export function mapDistanceRows(rows: unknown): RetrievedChunk[] {
  const list = Array.isArray(rows) ? rows : [];
  const result: RetrievedChunk[] = [];

  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as DistanceRow;
    if (typeof row.path !== "string" || typeof row.content !== "string") {
      continue;
    }
    const distance = Number(row.distance);
    // Cosine distance is lower-for-closer; map to a higher-is-better score in (0, 1]
    const score = Number.isFinite(distance) ? 1 / (1 + distance) : 0;
    result.push({
      path: row.path,
      content: row.content,
      score,
    });
  }

  return result;
}

/**
 * Format retrieved chunks for agent prompts.
 */
export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "";
  }

  const parts: string[] = [];
  for (const chunk of chunks) {
    parts.push(`### ${chunk.path} (score ${chunk.score.toFixed(3)})`);
    parts.push("```");
    parts.push(chunk.content);
    parts.push("```");
    parts.push("");
  }
  return parts.join("\n");
}

/**
 * Build a retrieval query from PR title + changed paths.
 */
export function buildRetrievalQuery(title: string, paths: string[]): string {
  const pathList = paths.join(", ");
  return `PR: ${title}\nChanged files: ${pathList}`;
}

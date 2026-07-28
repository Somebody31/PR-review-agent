import { and, eq } from "drizzle-orm";
import {
  codeChunks,
  repoFileIndex,
  type Database,
} from "@pr-review/db";
import { chunkTextByLines } from "./chunk.js";
import { embedTexts, type EmbedConfig } from "./embed.js";
import { hashContent } from "./hash.js";

/** Minimal file shape needed to index or purge RAG rows. */
type IndexableFile = {
  path: string;
  status: string;
  content?: string;
};

/**
 * Index changed PR files when content hash differs from repo_file_index.
 * Removed paths purge stored chunks/index so retrieval does not go stale.
 * Returns how many files were re-embedded.
 */
export async function indexChangedFiles(args: {
  db: Database;
  repoKey: string;
  files: IndexableFile[];
  embed: EmbedConfig;
  fetchImpl?: typeof fetch;
}): Promise<{ reembeddedFiles: number; skippedUnchanged: number }> {
  let reembeddedFiles = 0;
  let skippedUnchanged = 0;

  for (const file of args.files) {
    if (file.status === "removed") {
      await deleteIndexedFile(args.db, args.repoKey, file.path);
      continue;
    }

    if (!file.content) {
      continue;
    }

    const contentHash = hashContent(file.content);
    const previous = await findFileIndex(args.db, args.repoKey, file.path);

    if (previous && previous.contentHash === contentHash) {
      skippedUnchanged += 1;
      continue;
    }

    await reindexFile({
      db: args.db,
      repoKey: args.repoKey,
      path: file.path,
      content: file.content,
      contentHash,
      previousId: previous?.id,
      embed: args.embed,
      fetchImpl: args.fetchImpl,
    });
    reembeddedFiles += 1;
  }

  return { reembeddedFiles, skippedUnchanged };
}

type FileIndexRow = {
  id: string;
  contentHash: string;
};

/**
 * Look up the last indexed content hash for one path.
 */
async function findFileIndex(
  db: Database,
  repoKey: string,
  path: string,
): Promise<FileIndexRow | null> {
  const existing = await db
    .select()
    .from(repoFileIndex)
    .where(and(eq(repoFileIndex.repo, repoKey), eq(repoFileIndex.path, path)))
    .limit(1);

  const previous = existing[0];
  if (!previous) {
    return null;
  }
  return { id: previous.id, contentHash: previous.contentHash };
}

/**
 * Drop stored chunks and file-index row for a path (e.g. PR deleted the file).
 */
async function deleteIndexedFile(
  db: Database,
  repoKey: string,
  path: string,
): Promise<void> {
  await db
    .delete(codeChunks)
    .where(and(eq(codeChunks.repo, repoKey), eq(codeChunks.path, path)));
  await db
    .delete(repoFileIndex)
    .where(and(eq(repoFileIndex.repo, repoKey), eq(repoFileIndex.path, path)));
}

/**
 * Chunk, embed, replace stored chunks, and upsert the file index row.
 */
async function reindexFile(args: {
  db: Database;
  repoKey: string;
  path: string;
  content: string;
  contentHash: string;
  previousId: string | undefined;
  embed: EmbedConfig;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const chunks = chunkTextByLines(args.content);
  const inputs: string[] = [];
  for (const chunk of chunks) {
    inputs.push(chunk.content);
  }
  const vectors = await embedTexts({
    embed: args.embed,
    inputs,
    fetchImpl: args.fetchImpl,
  });

  await replaceFileChunks({
    db: args.db,
    repoKey: args.repoKey,
    path: args.path,
    chunks,
    vectors,
    contentHash: args.contentHash,
  });
  await upsertFileIndex({
    db: args.db,
    repoKey: args.repoKey,
    path: args.path,
    contentHash: args.contentHash,
    previousId: args.previousId,
  });
}

/**
 * Delete old chunks for a path and insert the new embedded windows.
 */
async function replaceFileChunks(args: {
  db: Database;
  repoKey: string;
  path: string;
  chunks: Array<{ chunkIndex: number; content: string }>;
  vectors: number[][];
  contentHash: string;
}): Promise<void> {
  await args.db
    .delete(codeChunks)
    .where(and(eq(codeChunks.repo, args.repoKey), eq(codeChunks.path, args.path)));

  const rows = args.chunks.map((chunk, i) => ({
    repo: args.repoKey,
    path: args.path,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    embedding: args.vectors[i],
    // Rough token estimate (~4 chars/token); not a real tokenizer
    tokenCount: Math.ceil(chunk.content.length / 4),
    contentHash: args.contentHash,
  }));

  if (rows.length > 0) {
    await args.db.insert(codeChunks).values(rows);
  }
}

/**
 * Update or insert repo_file_index so the next PR can skip unchanged hashes.
 */
async function upsertFileIndex(args: {
  db: Database;
  repoKey: string;
  path: string;
  contentHash: string;
  previousId: string | undefined;
}): Promise<void> {
  if (args.previousId) {
    await args.db
      .update(repoFileIndex)
      .set({
        contentHash: args.contentHash,
        lastIndexedAt: new Date(),
      })
      .where(eq(repoFileIndex.id, args.previousId));
    return;
  }

  await args.db.insert(repoFileIndex).values({
    repo: args.repoKey,
    path: args.path,
    contentHash: args.contentHash,
  });
}

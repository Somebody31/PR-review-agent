import { describe, expect, it, vi } from "vitest";
import type { Database } from "@pr-review/db";
import { hashContent } from "./hash.js";
import { indexChangedFiles } from "./index-files.js";

function createFakeDb(options: { existingHash?: string }): {
  db: Database;
  deleted: unknown[];
  insertedChunks: unknown[];
  insertedIndex: unknown[];
  updatedIndex: unknown[];
} {
  const deleted: unknown[] = [];
  const insertedChunks: unknown[] = [];
  const insertedIndex: unknown[] = [];
  const updatedIndex: unknown[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (!options.existingHash) {
              return [];
            }
            return [
              {
                id: "idx-1",
                repo: "acme/api",
                path: "src/a.ts",
                contentHash: options.existingHash,
              },
            ];
          },
        }),
      }),
    }),
    delete: () => ({
      where: async (clause: unknown) => {
        deleted.push(clause);
      },
    }),
    insert: (table: unknown) => ({
      values: async (rows: unknown) => {
        // Distinguish chunks vs index by shape of values
        if (Array.isArray(rows)) {
          insertedChunks.push(rows);
        } else {
          insertedIndex.push({ table, rows });
        }
      },
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          updatedIndex.push(values);
        },
      }),
    }),
  };

  return {
    db: db as unknown as Database,
    deleted,
    insertedChunks,
    insertedIndex,
    updatedIndex,
  };
}

describe("indexChangedFiles", () => {
  it("skips re-embed when content hash is unchanged", async () => {
    const content = "export const x = 1;\n";
    const existingHash = hashContent(content);
    const fake = createFakeDb({ existingHash });
    const fetchImpl = vi.fn();

    const stats = await indexChangedFiles({
      db: fake.db,
      repoKey: "acme/api",
      files: [
        {
          path: "src/a.ts",
          status: "modified",
          content,
        },
      ],
      embed: {
        baseUrl: "http://127.0.0.1:8000/v1",
        apiKey: "local",
        model: "Qwen/Qwen3-Embedding-0.6B",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(stats.skippedUnchanged).toBe(1);
    expect(stats.reembeddedFiles).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("embeds and stores chunks when hash is new", async () => {
    const content = "export const y = 2;\n";
    const fake = createFakeDb({});
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
        }),
        { status: 200 },
      );
    });

    const stats = await indexChangedFiles({
      db: fake.db,
      repoKey: "acme/api",
      files: [
        {
          path: "src/a.ts",
          status: "added",
          content,
        },
      ],
      embed: {
        baseUrl: "http://127.0.0.1:8000/v1",
        apiKey: "local",
        model: "Qwen/Qwen3-Embedding-0.6B",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(stats.reembeddedFiles).toBe(1);
    expect(stats.skippedUnchanged).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fake.insertedChunks.length).toBe(1);
    expect(fake.insertedIndex.length).toBe(1);
  });

  it("deletes stored chunks and index for removed files", async () => {
    const fake = createFakeDb({ existingHash: "old-hash" });
    const fetchImpl = vi.fn();

    const stats = await indexChangedFiles({
      db: fake.db,
      repoKey: "acme/api",
      files: [
        {
          path: "src/a.ts",
          status: "removed",
        },
      ],
      embed: {
        baseUrl: "http://127.0.0.1:8000/v1",
        apiKey: "local",
        model: "Qwen/Qwen3-Embedding-0.6B",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(stats.reembeddedFiles).toBe(0);
    expect(stats.skippedUnchanged).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    // code_chunks + repo_file_index
    expect(fake.deleted.length).toBe(2);
    expect(fake.insertedChunks.length).toBe(0);
  });
});

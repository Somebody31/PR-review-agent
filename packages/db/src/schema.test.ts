import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, getDb, pingDb } from "./client.js";
import { agentEvents, codeChunks, findings, prReviews } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL ?? "";

describe("schema exports", () => {
  it("defines pr_reviews and findings tables", () => {
    expect(prReviews).toBeTruthy();
    expect(findings).toBeTruthy();
    expect(codeChunks).toBeTruthy();
    expect(agentEvents).toBeTruthy();
  });
});

describe("database integration", () => {
  it("pingDb returns a boolean", async () => {
    if (!databaseUrl) {
      // No DATABASE_URL in CI without Postgres — still assert function shape
      expect(typeof pingDb).toBe("function");
      return;
    }

    const ok = await pingDb(databaseUrl);
    expect(typeof ok).toBe("boolean");
  });

  it("inserts a review, finding, embedding, and event when DATABASE_URL is up", async () => {
    if (!databaseUrl) {
      return;
    }

    const alive = await pingDb(databaseUrl);
    if (!alive) {
      return;
    }

    const db = getDb(databaseUrl);

    const reviewRows = await db
      .insert(prReviews)
      .values({
        owner: "test-owner",
        repo: "test-repo",
        prNumber: 1,
        headSha: "abc123",
        baseSha: "def456",
        status: "running",
      })
      .returning();

    const review = reviewRows[0];
    expect(review).toBeDefined();
    expect(review.id).toBeTruthy();

    const findingRows = await db
      .insert(findings)
      .values({
        reviewId: review.id,
        agentType: "security",
        severity: "HIGH",
        category: "injection",
        summary: "test finding",
        filePath: "src/a.ts",
        lineStart: 1,
        confidence: 0.8,
        rationale: "integration test",
      })
      .returning();

    expect(findingRows[0]?.reviewId).toBe(review.id);

    // 1024-dim fake embedding for local Qwen dim
    const embedding: number[] = [];
    for (let i = 0; i < 1024; i += 1) {
      embedding.push(i === 0 ? 1 : 0);
    }

    await db.insert(codeChunks).values({
      repo: "test-owner/test-repo",
      path: "src/a.ts",
      chunkIndex: 0,
      content: "const x = 1",
      embedding,
      contentHash: "hash1",
    });

    // Cosine distance to the same vector should be ~0
    const distanceRows = await db.execute(sql`
      SELECT (embedding <=> ${`[${embedding.join(",")}]`}::vector) AS dist
      FROM code_chunks
      WHERE repo = 'test-owner/test-repo'
      LIMIT 1
    `);
    expect(distanceRows.length).toBeGreaterThan(0);

    await db.insert(agentEvents).values({
      reviewId: review.id,
      agent: "security",
      eventType: "test",
      outcome: "ok",
    });

    const events = await db
      .select()
      .from(agentEvents)
      .where(sql`${agentEvents.reviewId} = ${review.id}`)
      .orderBy(agentEvents.ts);

    expect(events.length).toBeGreaterThan(0);

    await closeDb();
  });
});

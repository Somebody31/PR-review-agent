import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  customType,
} from "drizzle-orm/pg-core";

/** pgvector column stored as a float array in app code. */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    // 1024 matches Qwen3-Embedding-0.6B default max dim for local setup
    return "vector(1024)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    const trimmed = value.replace(/^\[/, "").replace(/\]$/, "");
    if (trimmed.length === 0) {
      return [];
    }
    const parts = trimmed.split(",");
    const numbers: number[] = [];
    for (const part of parts) {
      numbers.push(Number(part));
    }
    return numbers;
  },
});

/** Drop duplicate webhook deliveries (GitHub X-GitHub-Delivery). */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  eventName: text("event_name"),
});

export const prReviews = pgTable(
  "pr_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    prNumber: integer("pr_number").notNull(),
    headSha: text("head_sha").notNull(),
    baseSha: text("base_sha"),
    installationId: integer("installation_id"),
    status: text("status").notNull().default("queued"),
    overallConfidence: real("overall_confidence"),
    outcome: text("outcome"),
    summaryMarkdown: text("summary_markdown"),
    githubReviewId: text("github_review_id"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pr_reviews_repo_pr_idx").on(table.owner, table.repo, table.prNumber),
    index("pr_reviews_head_sha_idx").on(table.owner, table.repo, table.headSha),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => prReviews.id, { onDelete: "cascade" }),
    agentType: text("agent_type").notNull(),
    severity: text("severity").notNull(),
    category: text("category").notNull(),
    summary: text("summary").notNull(),
    filePath: text("file_path").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end"),
    suggestion: text("suggestion"),
    confidence: real("confidence").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("findings_review_id_idx").on(table.reviewId)],
);

export const hitlItems = pgTable("hitl_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewId: uuid("review_id")
    .notNull()
    .references(() => prReviews.id, { onDelete: "cascade" }),
  state: text("state").notNull().default("pending"),
  assignee: text("assignee"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hitlFeedback = pgTable("hitl_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewId: uuid("review_id").references(() => prReviews.id, { onDelete: "cascade" }),
  findingId: uuid("finding_id").references(() => findings.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const codeChunks = pgTable(
  "code_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repo: text("repo").notNull(),
    path: text("path").notNull(),
    symbol: text("symbol"),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding"),
    tokenCount: integer("token_count"),
    contentHash: text("content_hash"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("code_chunks_repo_path_chunk_idx").on(table.repo, table.path, table.chunkIndex),
    index("code_chunks_repo_path_idx").on(table.repo, table.path),
  ],
);

export const repoFileIndex = pgTable(
  "repo_file_index",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repo: text("repo").notNull(),
    path: text("path").notNull(),
    contentHash: text("content_hash").notNull(),
    lastIndexedAt: timestamp("last_indexed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("repo_file_index_repo_path_idx").on(table.repo, table.path)],
);

export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    reviewId: uuid("review_id"),
    agent: text("agent"),
    spanId: varchar("span_id", { length: 64 }),
    parentSpan: varchar("parent_span", { length: 64 }),
    eventType: text("event_type").notNull(),
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    outcome: text("outcome"),
    confidence: real("confidence"),
    payload: jsonb("payload"),
  },
  (table) => [
    index("agent_events_review_id_idx").on(table.reviewId),
    index("agent_events_ts_idx").on(table.ts),
  ],
);

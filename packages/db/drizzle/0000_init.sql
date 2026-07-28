CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "delivery_id" text PRIMARY KEY NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "event_name" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pr_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner" text NOT NULL,
  "repo" text NOT NULL,
  "pr_number" integer NOT NULL,
  "head_sha" text NOT NULL,
  "base_sha" text,
  "installation_id" integer,
  "status" text DEFAULT 'queued' NOT NULL,
  "overall_confidence" real,
  "outcome" text,
  "summary_markdown" text,
  "github_review_id" text,
  "cost_usd" numeric(12, 6),
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pr_reviews_repo_pr_idx" ON "pr_reviews" ("owner", "repo", "pr_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pr_reviews_head_sha_idx" ON "pr_reviews" ("owner", "repo", "head_sha");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "review_id" uuid NOT NULL REFERENCES "pr_reviews"("id") ON DELETE cascade,
  "agent_type" text NOT NULL,
  "severity" text NOT NULL,
  "category" text NOT NULL,
  "summary" text NOT NULL,
  "file_path" text NOT NULL,
  "line_start" integer NOT NULL,
  "line_end" integer,
  "suggestion" text,
  "confidence" real NOT NULL,
  "rationale" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "findings_review_id_idx" ON "findings" ("review_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hitl_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "review_id" uuid NOT NULL REFERENCES "pr_reviews"("id") ON DELETE cascade,
  "state" text DEFAULT 'pending' NOT NULL,
  "assignee" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hitl_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "review_id" uuid REFERENCES "pr_reviews"("id") ON DELETE cascade,
  "finding_id" uuid REFERENCES "findings"("id") ON DELETE cascade,
  "action" text NOT NULL,
  "comment" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "code_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repo" text NOT NULL,
  "path" text NOT NULL,
  "symbol" text,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "embedding" vector(1024),
  "token_count" integer,
  "content_hash" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "code_chunks_repo_path_chunk_idx" ON "code_chunks" ("repo", "path", "chunk_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "code_chunks_repo_path_idx" ON "code_chunks" ("repo", "path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "code_chunks_embedding_hnsw_idx" ON "code_chunks" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repo_file_index" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repo" text NOT NULL,
  "path" text NOT NULL,
  "content_hash" text NOT NULL,
  "last_indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repo_file_index_repo_path_idx" ON "repo_file_index" ("repo", "path");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ts" timestamp with time zone DEFAULT now() NOT NULL,
  "review_id" uuid,
  "agent" text,
  "span_id" varchar(64),
  "parent_span" varchar(64),
  "event_type" text NOT NULL,
  "model" text,
  "tokens_in" integer,
  "tokens_out" integer,
  "cost_usd" numeric(12, 6),
  "latency_ms" integer,
  "outcome" text,
  "confidence" real,
  "payload" jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_review_id_idx" ON "agent_events" ("review_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_ts_idx" ON "agent_events" ("ts");

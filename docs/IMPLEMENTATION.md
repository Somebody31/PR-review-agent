# Implementation Plan — AI PR Review Agent (TypeScript)

**Status:** Build plan (pre-code)  
**Companion:** [ARCHITECTURE.md](./ARCHITECTURE.md)  
**Rule:** Each step ends with a **green gate**. Do not start the next step until the gate passes.

This document turns the architecture into an ordered build. It is intentionally more granular than a 20-phase product curriculum so a small team (or solo) can ship a vertical slice early, then harden.

---

## How to use this plan

1. Work **in order** within a phase; phases are mostly sequential.
2. Each step lists **goal**, **work**, **files/packages**, and **green gate**.
3. Prefer thin vertical slices over perfect abstractions.
4. Log meaningful deviations in [DECISIONS.md](./DECISIONS.md).
5. Keep auto-post **disabled** until Step 8 (eval baseline) unless you explicitly accept noise.

### Phase map (overview)

| Phase | Name | Outcome |
|-------|------|---------|
| **0** | Foundations | Repo, tooling, docs alignment |
| **1** | Data spine | Postgres schema + migrations |
| **2** | Ingress & queue | Webhook → Redis job |
| **3** | Context pipeline | Fetch PR diff + basic context |
| **4** | Agents & orchestrator | 4 specialists + merge (no RAG yet) |
| **5** | Memory & RAG | Index code + hybrid retrieve |
| **6** | Posting & reliability | GitHub review + retries/idempotency |
| **7** | Events, budget, dashboard | Proof + cost + UI shell |
| **8** | HITL, security, eval | Exceptions, hardening, golden set |
| **9** | Polish & ops | CI, deploy, continuous learning hooks |

---

# Phase 0 — Foundations

## Step 0.1 — Initialize monorepo

**Goal:** Empty TypeScript monorepo that builds.

**Work:**

- `pnpm` workspace root.
- `apps/api`, `apps/worker`, `apps/web` (can be stubs).
- `packages/shared` with shared tsconfig base.
- ESLint, Prettier, TypeScript project references (or simple workspace paths).
- Root scripts: `build`, `dev`, `test`, `lint`, `typecheck`.
- `.gitignore`, `.env.example`, `README.md` (link to docs).
- `docker-compose.yml` with:
  - `postgres` image with **pgvector**
  - `redis`

**Green gate:**

- `pnpm install` succeeds.
- `pnpm typecheck` succeeds on empty packages.
- `docker compose up -d` starts Postgres and Redis; healthchecks pass.

---

## Step 0.2 — Config & logging

**Goal:** Typed configuration and structured logs everywhere.

**Work:**

- `packages/core` (or `shared`) env loader with Zod (`DATABASE_URL`, `REDIS_URL`, GitHub, OpenAI, thresholds).
- Fail fast on missing required env in production.
- `pino` logger helper used by api and worker.

**Green gate:**

- Starting api without `DATABASE_URL` fails with a clear error.
- Logger prints JSON in production mode, pretty in dev.

---

## Step 0.3 — Freeze contracts (types)

**Goal:** Shared domain types before business logic.

**Work:** In `packages/shared`:

- Zod schemas: `Finding`, `ReviewResult`, `ReviewJob`, severities, agent types.
- Export inferred TypeScript types.
- Document field meanings in short JSDoc / comments.

**Green gate:**

- Invalid finding (e.g. confidence `2`) fails Zod parse in a unit test.

---

# Phase 1 — Data spine

## Step 1.1 — Database package & connection

**Goal:** Drizzle (or chosen ORM) connected to Postgres.

**Work:**

- `packages/db`: client, pool, `migrate` script.
- Connection from `DATABASE_URL`.
- Simple health query `SELECT 1`.

**Green gate:**

- Migration tooling runs against docker Postgres.
- Health query succeeds from a small script.

---

## Step 1.2 — Schema: truth + idempotency

**Goal:** Tables for reviews and webhook dedup.

**Work:** Create migrations for:

| Table | Purpose |
|-------|---------|
| `webhook_deliveries` | `delivery_id` PK, `received_at` |
| `pr_reviews` | review id, repo, pr number, head sha, status, overall confidence, github review id, costs summary |
| `findings` | review FK, agent, severity, category, location, confidence, rationale, suggestion |
| `hitl_items` | review FK, state (`pending`/`approved`/`rejected`), assignee optional |
| `hitl_feedback` | finding/review FK, action, comment, created_at |

**Green gate:**

- Migrate up/down (or at least up) on clean DB.
- Can insert a review + finding via repository unit/integration test.

---

## Step 1.3 — Schema: memory + events

**Goal:** Code chunks and event log.

**Work:**

```
code_chunks (
  id, repo, path, symbol, chunk_index,
  content, embedding vector(...), token_count, updated_at
)
repo_file_index (
  repo, path, content_hash, last_indexed_at
)
agent_events (
  ts, review_id, agent, span_id, parent_span,
  event_type, model, tokens_in, tokens_out,
  cost_usd, latency_ms, outcome, confidence, payload jsonb
)
```

- Enable `CREATE EXTENSION IF NOT EXISTS vector`.
- Vector index (HNSW or IVFFlat for local; DiskANN if Tiger/pgvectorscale later).
- Optional: `tsvector` + GIN for FTS.

**Green gate:**

- Insert a fake embedding; cosine / distance query returns it.
- Insert an `agent_events` row; query by `review_id` ordered by `ts`.

---

# Phase 2 — Ingress & queue

## Step 2.1 — API app skeleton

**Goal:** Hono (or Fastify) server boots with health routes.

**Work:**

- `GET /health` → `{ ok: true, db?: ..., redis?: ... }`
- Graceful shutdown hooks.
- Request id middleware.

**Green gate:**

- `curl localhost:PORT/health` returns 200.

---

## Step 2.2 — Webhook signature verification

**Goal:** Reject forged GitHub webhooks.

**Work:**

- `packages/github`: `verifyWebhookSignature(rawBody, signatureHeader, secret)`.
- Route `POST /webhooks/github` reads **raw body** for HMAC.
- On failure → 401.

**Green gate:**

- Unit tests: valid signature accepts; tampered body rejects.
- Manual: send signed fixture payload → 200; unsigned → 401.

---

## Step 2.3 — Idempotent enqueue

**Goal:** Same delivery never processed twice.

**Work:**

- Parse `X-GitHub-Delivery`, event name, action.
- Only handle `pull_request` + `opened|synchronize|reopened` (log+ignore others).
- Insert `webhook_deliveries`; on unique violation → return 200 without re-enqueue.
- Enqueue BullMQ job with stable job id including delivery id or `repo:pr:sha`.

**Green gate:**

- Double-post same delivery → one job only.
- Redis shows job payload with owner/repo/pr/sha.

---

## Step 2.4 — Worker skeleton

**Goal:** Worker process consumes jobs and acks.

**Work:**

- `apps/worker` BullMQ worker.
- Handler logs job and marks complete (no agents yet).
- Concurrency = 1 initially.
- Failed jobs retry with exponential backoff; dead-letter after N attempts.

**Green gate:**

- Enqueue from webhook (or CLI) → worker log shows job completed.

---

# Phase 3 — Context pipeline

## Step 3.1 — GitHub App authentication

**Goal:** Obtain installation access token.

**Work:**

- Load App id + private key.
- Octokit App auth.
- Helper `getInstallationOctokit(installationId)`.

**Green gate:**

- Script can list PRs or fetch a known test PR with App credentials.

---

## Step 3.2 — Fetch PR material

**Goal:** Worker can load everything needed for a review.

**Work:**

- Fetch PR metadata, files list, patch/diff for changed files.
- Optionally fetch file contents at `headSha` for changed paths.
- Normalize into `PrContext`:

```ts
interface PrContext {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  headSha: string;
  baseSha: string;
  files: Array<{
    path: string;
    status: string;
    patch?: string;
    content?: string;
  }>;
}
```

**Green gate:**

- Integration test against a fixture repo/PR (or recorded fixtures) produces non-empty `files`.

---

## Step 3.3 — Persist review shell

**Goal:** Create `pr_reviews` row when work starts.

**Work:**

- Status lifecycle: `queued` → `running` → `completed` | `failed` | `hitl_pending`.
- Store head sha; later prevent duplicate completed reviews for same sha (policy choice).

**Green gate:**

- After worker run, DB has a review row in `running` then terminal status.

---

# Phase 4 — Agents & orchestrator (no RAG yet)

## Step 4.1 — LLM client + structured output

**Goal:** Call model and parse into Zod schema.

**Work:**

- `packages/agents` or `packages/core` LLM client interface:

```ts
interface LlmClient {
  completeStructured<T>(args: {
    system: string;
    user: string;
    schema: ZodType<T>;
    model?: string;
    maxTokens?: number;
  }): Promise<{ data: T; usage: TokenUsage; model: string; latencyMs: number }>;
}
```

- OpenAI implementation (JSON schema / tool response / constrained parse + retry once on validation failure).
- Token cost estimation table (model → $/1M tokens).

**Green gate:**

- Unit test with mocked HTTP returns valid `Finding[]`.
- Invalid JSON triggers one repair retry then fails clearly.

---

## Step 4.2 — Prompt registry

**Goal:** Versioned prompts per agent.

**Work:**

- `packages/prompts`: files or TS modules:

  - `security.v1.md`
  - `quality.v1.md`
  - `tests.v1.md`
  - `docs.v1.md`
  - shared system preamble (selective, cite evidence, allow “no findings”)

- Registry: `getPrompt(agent, version)`.

**Green gate:**

- Registry returns prompts; missing version throws.

---

## Step 4.3 — Base agent + four specialists

**Goal:** Four domain agents produce `Finding[]` from diff-only context (temporary).

**Work:**

- `BaseAgent.run({ prContext, extraContext, reviewId })`.
- Specialists pass different prompts.
- Cap findings per agent (e.g. max 10) to force selectivity.
- Filter INFO noise if policy says so.

**Green gate:**

- Against a fixture PR containing an intentional issue (e.g. SQL string concat), security agent returns ≥1 finding with file path.

---

## Step 4.4 — Aggregator

**Goal:** Merge, dedup, score confidence, choose outcome.

**Work:**

- Dedup key: `filePath + lineStart + category` (tune later).
- Keep highest confidence; record `agreedBy: AgentType[]` in payload if useful.
- `overallConfidence` formula documented in code comments.
- Outcome: `auto_post` | `hitl_queue` | `critical_escalate`.
- Respect `AUTO_POST_ENABLED=false` → force HITL or “draft only”.

**Green gate:**

- Unit tests cover: duplicate findings collapse; CRITICAL forces escalate; low confidence → hitl.

---

## Step 4.5 — Wire orchestrator in worker

**Goal:** End-to-end job → findings in DB (still no GitHub post).

**Work:**

```
load context → create review → run 4 agents in parallel → aggregate
→ save findings → set status
```

- Per-agent timeout (e.g. 60s).
- If 1–3 agents fail, continue with partial + lower confidence.

**Green gate:**

- Real or fixture webhook → worker → `findings` rows in Postgres.
- Logs show four agent timings.

---

# Phase 5 — Memory & RAG

## Step 5.1 — Chunking + embeddings

**Goal:** Turn repo files into stored chunks.

**Work:**

- Chunk strategy v1: sliding window by lines (~80–120 lines, overlap 20) **or** simple symbol split if cheap.
- Embedder using OpenAI embeddings API.
- Batch upsert into `code_chunks`.
- Update `repo_file_index` with content hash.

**Green gate:**

- Index a small public fixture repo; `code_chunks` count > 0; embeddings non-null.

---

## Step 5.2 — Hybrid retrieval

**Goal:** Agents receive relevant context.

**Work:**

- `retrieveContext(repo, queryText, k)`:
  1. Embed query (diff summary + changed paths).
  2. Vector top-k.
  3. FTS top-k (if enabled).
  4. Reciprocal rank fusion.
  5. Return unique chunks with path + content.

- Inject into agent user message under `## Repository context`.

**Green gate:**

- Query for a known function name returns that file in top results.
- Agent prompts include non-empty context on a real PR fixture.

---

## Step 5.3 — Incremental indexing in pipeline

**Goal:** Avoid full reindex every PR.

**Work:**

- Before agents: ensure changed files (and maybe imports/siblings) are indexed at `headSha` or approximate latest.
- Re-embed only if content hash changed.

**Green gate:**

- Second review of same files does not re-embed unchanged hashes (assert via logs/metrics).

---

# Phase 6 — Posting & reliability

## Step 6.1 — Post review to GitHub

**Goal:** Publish structured review.

**Work:**

- Map findings → review body markdown (grouped by severity/agent).
- Create PR review via Octokit (`REQUEST_CHANGES` only if CRITICAL/HIGH policy says so; default `COMMENT`).
- Attempt inline comments when line is present in the PR diff; else list in summary.
- Store `github_review_id` on `pr_reviews`.

**Green gate:**

- Review appears on a test PR; DB stores GitHub id.

---

## Step 6.2 — Reliability toolkit

**Goal:** Harden external calls.

**Work:** In `packages/reliability`:

- `withRetry` (exponential backoff, jitter, retryable status codes).
- `withTimeout`.
- Circuit breaker around LLM provider (optional but recommended).
- Idempotent post: if review already posted for `(repo, pr, headSha)`, skip.

**Green gate:**

- Simulated 500 from GitHub retries then succeeds.
- Timeout fires on hung promise.
- Re-run job does not create duplicate reviews.

---

## Step 6.3 — Partial failure policy

**Goal:** Documented, tested degradation.

**Work:**

- Define: min agents required (e.g. ≥2 success) else `failed` / HITL.
- Always persist whatever findings exist.
- Emit failure events.

**Green gate:**

- Mock 2 agents failing → still completes with reduced confidence and HITL outcome when auto-post on.

---

# Phase 7 — Events, budget, dashboard

## Step 7.1 — Event emission

**Goal:** Every action writes `agent_events`.

**Work:**

- `emitAgentEvent({...})` helper.
- Instrument: review start/end, each agent span, each LLM call, aggregate decision, github post, errors.
- Include cost fields on LLM events.

**Green gate:**

- One full run produces a queryable timeline for `review_id`.

---

## Step 7.2 — BudgetGuard

**Goal:** Hard stop when daily budget exceeded.

**Work:**

- Sum `cost_usd` for UTC day (or rolling 24h — document choice).
- Before LLM call: if `spent + estimate > DAILY_BUDGET_USD` → throw `BudgetExceededError`.
- Worker marks review `failed` or `hitl_pending` with reason.

**Green gate:**

- With budget `0`, agent does not call LLM; event records block.

---

## Step 7.3 — REST API for dashboard

**Goal:** Read models for UI.

**Work:**

- `GET /api/reviews`
- `GET /api/reviews/:id` (findings + events summary)
- `GET /api/reviews/:id/events`
- `GET /api/economics/summary` (cost by day/agent)
- `GET /api/hitl` (later full write in Phase 8)

Protect with simple API key or session (v1).

**Green gate:**

- curl returns JSON matching DB for a known review.

---

## Step 7.4 — Next.js dashboard shell

**Goal:** Humans can see reviews without SQL.

**Work:**

- Pages:
  - `/` list reviews
  - `/reviews/[id]` findings + confidence + cost
  - `/reviews/[id]/trace` event timeline
  - `/economics` simple charts/tables
- Server components fetch API or use shared db package carefully (prefer API boundary).

**Green gate:**

- Browser shows a completed review with findings list.

---

# Phase 8 — HITL, security, evaluation

## Step 8.1 — HITL queue flows

**Goal:** Approve / reject before post when gated.

**Work:**

- When outcome is HITL: do **not** post; insert `hitl_items`.
- API:
  - `POST /api/hitl/:id/approve` → post to GitHub
  - `POST /api/hitl/:id/reject` → close without post
  - Optional edit findings before approve
- Dashboard HITL page.

**Green gate:**

- Low-confidence run appears in queue; approve publishes review; reject does not.

---

## Step 8.2 — Dispute / feedback capture

**Goal:** Learn later without poisoning now.

**Work:**

- `POST /api/findings/:id/dispute` stores feedback.
- No automatic prompt mutation from single dispute.
- Document minimum evidence threshold for future learning.

**Green gate:**

- Dispute row persists; UI shows disputed state.

---

## Step 8.3 — Security hardening pass

**Goal:** Threat model + basics enforced.

**Work:**

- Short threat model doc in `docs/SECURITY.md` (webhook forgery, prompt injection, secret leakage, privilege abuse).
- Mask secrets in logs/events (regex heuristics).
- Ensure raw webhook secret and private keys never sent to LLM.
- Dashboard auth required for HITL mutations.
- Rate limit webhook endpoint lightly if exposed.

**Green gate:**

- Checklist signed off in PR description; secret-mask unit tests pass.

---

## Step 8.4 — Golden dataset & regression gate

**Goal:** Quality bar for changes to prompts/models.

**Work:**

- `packages/evaluation` or `evals/`:
  - 5–15 fixture PRs (can be synthetic diffs in-repo).
  - Expected finding categories (not always exact lines).
- Runner script outputs precision/recall-ish metrics.
- CI job: `pnpm eval` fails if below thresholds.

**Green gate:**

- `pnpm eval` runs locally green on main.
- Intentionally breaking a prompt fails the gate.

---

## Step 8.5 — Enable auto-post (policy)

**Goal:** Turn on autonomy only after gates exist.

**Work:**

- Set `AUTO_POST_ENABLED=true` in staging first.
- Monitor dispute rate and HITL rate for a trial period.
- Tune `HITL_CONFIDENCE_THRESHOLD`.

**Green gate:**

- Staging: auto-posted reviews on high-confidence non-critical PRs; critical still escalates.

---

# Phase 9 — Polish & operations

## Step 9.1 — CI/CD

**Goal:** Automated quality on every PR to this repo.

**Work:**

- GitHub Actions: install, typecheck, unit tests, eval (fixtures only), docker compose for integration if feasible.
- Optional: build Docker images for api/worker/web.

**Green gate:**

- PR CI red on type error / failed unit test.

---

## Step 9.2 — Observability beyond SQL

**Goal:** Ops-friendly signals.

**Work:**

- Metrics: queue depth, job duration, LLM error rate, cost/day (can start as SQL views).
- Alert hooks (webhook/Slack) when BudgetGuard trips or failure rate spikes.
- Optional OpenTelemetry export later.

**Green gate:**

- Dashboard or log-based alert fires in a forced failure drill.

---

## Step 9.3 — Deployment runbook

**Goal:** Reproducible deploy.

**Work:**

- `docs/RUNBOOK.md`: env vars, migrate, scale workers, rotate GitHub webhook secret, replay failed jobs.
- Production compose or IaC notes (Fly/Render/Railway/K8s — pick one).

**Green gate:**

- Fresh environment brought up from runbook by following steps only (self-test or peer).

---

## Step 9.4 — Continuous learning hooks (light)

**Goal:** Close the loop without full ML ops.

**Work:**

- Weekly report query: rejection_rate / dispute_rate by agent.
- Prompt changelog process: new prompt version + eval must pass before promote.
- Drift flag if dispute rate exceeds threshold (dashboard banner is enough).

**Green gate:**

- Report query documented and runnable; prompt version bump reflected in events.

---

# Vertical slice checkpoints

Ship value early; do not wait for Phase 9.

| Checkpoint | After steps | Demo |
|------------|-------------|------|
| **Slice A** | 0.x–2.4 | Webhook accepted, job consumed |
| **Slice B** | +3.x–4.5 | Findings in DB for a PR |
| **Slice C** | +6.1 | Comments on GitHub |
| **Slice D** | +5.x | Grounded findings (RAG) |
| **Slice E** | +7.x–8.1 | Dashboard + HITL |
| **Slice F** | +8.4–9.x | Eval + CI + runbook |

Recommended first public demo: **Slice C**, then add RAG (D) quickly after.

---

# Suggested implementation order (checklist)

Copy into an issue tracker if useful.

**Phase 0**

- [ ] 0.1 Monorepo + docker compose  
- [ ] 0.2 Config + logging  
- [ ] 0.3 Shared Zod contracts  

**Phase 1**

- [ ] 1.1 DB package  
- [ ] 1.2 Truth schema  
- [ ] 1.3 Memory + events schema  

**Phase 2**

- [ ] 2.1 API health  
- [ ] 2.2 Webhook HMAC  
- [ ] 2.3 Idempotent enqueue  
- [ ] 2.4 Worker consumes  

**Phase 3**

- [ ] 3.1 GitHub App auth  
- [ ] 3.2 Fetch PR context  
- [ ] 3.3 Persist review shell  

**Phase 4**

- [ ] 4.1 LLM structured client  
- [ ] 4.2 Prompt registry  
- [ ] 4.3 Four agents  
- [ ] 4.4 Aggregator  
- [ ] 4.5 Orchestrator wired  

**Phase 5**

- [ ] 5.1 Chunk + embed  
- [ ] 5.2 Hybrid retrieve  
- [ ] 5.3 Incremental index  

**Phase 6**

- [ ] 6.1 Post GitHub review  
- [ ] 6.2 Retry/timeout/idempotent post  
- [ ] 6.3 Partial failure policy  

**Phase 7**

- [ ] 7.1 Events spine  
- [ ] 7.2 BudgetGuard  
- [ ] 7.3 REST read API  
- [ ] 7.4 Dashboard shell  

**Phase 8**

- [ ] 8.1 HITL approve/reject  
- [ ] 8.2 Dispute feedback  
- [ ] 8.3 Security pass  
- [ ] 8.4 Golden evals  
- [ ] 8.5 Enable auto-post carefully  

**Phase 9**

- [ ] 9.1 CI  
- [ ] 9.2 Alerts/metrics  
- [ ] 9.3 Runbook  
- [ ] 9.4 Learning hooks  

---

# Estimation guide (solo, rough)

| Phases | Calendar (part-time) | Calendar (focused) |
|--------|----------------------|--------------------|
| 0–2 Slice A | 2–4 days | 1–2 days |
| 3–4 Slice B | 3–6 days | 2–3 days |
| 6 Slice C | 1–2 days | 1 day |
| 5 Slice D | 2–4 days | 1–2 days |
| 7–8 Slice E–F | 1–2 weeks | 4–6 days |
| 9 polish | ongoing | 2–3 days |

Estimates assume GitHub App and OpenAI access already available.

---

# Definition of Done (product MVP)

The system is an MVP when:

1. A GitHub PR on a connected repo triggers a review job.
2. Four specialists run (grounded with RAG).
3. Findings are structured, stored, and selectively posted (or HITL).
4. CRITICAL never silent-auto-posts without escalation path.
5. Events show cost and timeline for each review.
6. Golden eval suite exists and runs in CI.
7. Runbook can recreate the environment.

---

# Next action

Start **Step 0.1** (monorepo + docker compose) when ready to write code. Keep this file updated if step order changes; record why in `DECISIONS.md`.

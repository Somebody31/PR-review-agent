# Architecture Plan — AI PR Review Agent (TypeScript)

**Status:** Draft plan (pre-implementation)  
**Language:** TypeScript end-to-end  
**Inspired by:** [Antern — Production-grade AI PR review agent](https://www.antern.co/blogs/production-grade-ai-pr-review-agent/)  
**Related:** [IMPLEMENTATION.md](./IMPLEMENTATION.md) (step-by-step build)

---

## 1. Purpose

### Problem

Senior engineer time is scarce. Manual PR review is slow, inconsistent, and fatiguing. Much of review is mechanical pattern recognition (security smells, missing tests, unclear docs, obvious logic issues).

### Goal

Build an **agentic PR review system** that:

1. Runs automatically when a GitHub PR is opened or updated.
2. Produces **selective, high-value, structured findings** (not comment spam).
3. Grounds reasoning in **repository context** (RAG), not the raw diff alone.
4. Uses **four specialist agents** in parallel, then merges results.
5. Posts automatically when confident; routes uncertain/critical cases to **humans**.
6. Records **proof**: traces, audit trail, and token/cost attribution.

### Non-goals (v1)

- Fully replacing human review for merges.
- Auto-approving or auto-merging PRs.
- Full monorepo multi-language static analysis product.
- Multi-tenant SaaS billing (single org / self-hosted first).

### One-sentence system

> GitHub PR → verify & enqueue → four grounded specialist agents → merge & gate → post review or HITL → log everything.

---

## 2. Design principles

| Principle | Meaning |
|-----------|---------|
| **Selectivity** | Optimize for findings worth a senior’s attention, not coverage volume. |
| **Structured contracts** | Agents return data (`Finding[]`), not free-form prose blobs. |
| **Grounding** | Every specialist reasons over diff **plus** retrieved code context. |
| **Proof** | Every span, LLM call, tool call, and decision is an append-only event. |
| **Fail safe** | Prefer slower-but-correct over fast-but-wrong; timeouts, retries, circuit breakers. |
| **Earned autonomy** | High confidence + no CRITICAL → auto-post; otherwise human handles exceptions. |
| **One durable spine** | Memory, truth, and time live in one Postgres-compatible store; Redis only for queue/cache. |
| **Swappable hard parts** | Orchestration and LLM providers sit behind narrow interfaces. |

---

## 3. Trigger, output, and core contract

### Trigger

- GitHub webhook events: `pull_request` (`opened`, `synchronize`, `reopened`).
- Optional later: `pull_request_review_comment` for dispute/feedback loops.

### Output

- A single structured review posted to the PR (summary + inline comments where possible).
- Or: a pending human-approval queue entry (no post yet).

### Core object: `Finding`

```ts
type AgentType = "security" | "quality" | "tests" | "docs";
type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

interface Finding {
  agentType: AgentType;
  severity: Severity;
  category: string;          // e.g. "injection", "missing-test"
  summary: string;
  filePath: string;
  lineStart: number;
  lineEnd?: number;
  suggestion?: string;
  confidence: number;        // 0..1
  rationale: string;         // why — required for audit/dispute
}
```

### Aggregated review

```ts
interface ReviewResult {
  reviewId: string;
  prNumber: number;
  repo: string;              // owner/name
  findings: Finding[];       // after dedup
  overallConfidence: number;
  outcome: "auto_post" | "hitl_queue" | "critical_escalate";
  summaryMarkdown: string;
}
```

---

## 4. System context

```
┌─────────────┐     webhook      ┌──────────────────┐
│   GitHub    │ ───────────────► │  API (Hono)      │
│  PR events  │ ◄─────────────── │  HMAC + enqueue  │
└─────────────┘   post review    └────────┬─────────┘
                                          │
                                          ▼
                                 ┌──────────────────┐
                                 │ Redis + BullMQ   │
                                 └────────┬─────────┘
                                          │
                                          ▼
                                 ┌──────────────────┐
                                 │ Worker process   │
                                 │  orchestrator    │
                                 └───┬──┬──┬──┬─────┘
                     security quality tests docs
                           │    │    │    │
                           └────┴────┴────┘
                                    │
                                    ▼
                              aggregator
                                    │
                     ┌──────────────┼──────────────┐
                     ▼              ▼              ▼
               post GitHub    HITL queue     agent_events
                     │              │              │
                     └──────────────┴──────────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Postgres (+pgvector │
                         │  + optional TS)     │
                         │ memory · truth ·    │
                         │ time                │
                         └─────────────────────┘
                                    ▲
                                    │
                         ┌─────────────────────┐
                         │ Next.js dashboard   │
                         │ reviews · HITL ·    │
                         │ traces · cost       │
                         └─────────────────────┘
```

---

## 5. Runtime architecture

### 5.1 Ingress (API)

**Responsibilities only:**

1. Verify `X-Hub-Signature-256` (HMAC-SHA256 with webhook secret).
2. Enforce idempotency via `X-GitHub-Delivery` (store delivery id; drop duplicates).
3. Parse PR identity (repo, number, head SHA, installation id).
4. Enqueue BullMQ job `review.pr`.
5. Return **200 quickly** (GitHub expects fast ack).

**Does not:** call LLMs, clone repos, or run agents inline.

### 5.2 Queue

| Choice | Why |
|--------|-----|
| **Redis + BullMQ** | Mature TS ecosystem; retries, delayed jobs, concurrency, job ids for idempotency |

Job payload (minimal):

```ts
interface ReviewJob {
  deliveryId: string;
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
}
```

### 5.3 Orchestrator (Worker)

Preferred v1 approach (simple, no LangGraph required):

```
buildContext → Promise.all([security, quality, tests, docs]) → aggregate → route
```

Each node:

- Has a **timeout**.
- Emits **start/end/error** events.
- On partial failure: continue with available specialists (degrade gracefully).

**Interface (swap later if needed):**

```ts
interface WorkflowEngine {
  run(workflowId: string, input: ReviewJob): Promise<ReviewResult>;
  getState(workflowId: string): Promise<unknown | null>;
}
```

Optional later: LangGraph.js or Temporal TypeScript SDK behind the same interface when concurrency/durability demands it.

### 5.4 Specialists

Four agents share one base pipeline:

1. **BudgetGuard** — block if daily spend exceeds cap.
2. **Retrieve** — hybrid search for context chunks related to the diff.
3. **LLM** — domain prompt + structured output (Zod schema).
4. **Emit events** — tokens, cost, latency, model.
5. **Return** `Finding[]`.

| Agent | Mindset |
|-------|---------|
| `security` | Injection, secrets, auth bypass, unsafe deserialization |
| `quality` | Correctness, logic bugs, complexity, smells |
| `tests` | Missing cases, brittle tests, coverage gaps |
| `docs` | Missing/outdated docs, unexplained public APIs |

Agents differ only in **prompt** and light post-processing — not in plumbing.

### 5.5 Aggregator & HITL gate

1. Concatenate findings from all agents.
2. **Dedup** same `(filePath, lineStart)` (keep highest confidence; note multi-agent agreement).
3. Compute `overallConfidence` (e.g. mean of finding confidences, weighted by severity).
4. Gate:

| Condition | Action |
|-----------|--------|
| Any `CRITICAL` | Escalate (HITL / notify); do not silent auto-post only |
| `overallConfidence` < threshold | HITL approval queue |
| Otherwise | Auto-post to GitHub |

Threshold is configurable (start conservative, e.g. `0.75`).

### 5.6 GitHub integration

- Prefer **GitHub App** (installation tokens, least privilege, webhook per install).
- Create a **Pull Request Review** with summary body.
- Attach **inline comments** where `filePath`/`line` map to the diff (skip or downgrade to body if line not in diff).
- Use Octokit with retry + rate-limit awareness.

### 5.7 Retrieval (memory)

**Problem:** LLM with only the diff hallucinates confidently.

**Solution:** hybrid retrieval over indexed repo chunks:

1. Chunk files (by symbol/window).
2. Embed with `text-embedding-3-large` (or smaller/cheaper model for v1).
3. Store in `code_chunks.embedding` (pgvector).
4. At review time:
   - Embed diff / changed symbols.
   - **Vector search** (semantic).
   - **Full-text search** (exact identifiers).
   - **Reciprocal rank fusion** → top-k into the prompt.
5. Track freshness via `repo_file_index.last_indexed_at`; re-embed changed files.

**Ingestion triggers:**

- Onboarding: full index of default branch.
- Ongoing: after review jobs, or scheduled; prioritize files touched by the PR.

### 5.8 Events spine (observability / economics / audit)

One append-only stream powers three consumers:

| Consumer | Question |
|----------|----------|
| Trace viewer | What happened for this review, in order? |
| Audit trail | Why was this finding raised? |
| Cost ledger | What did this PR / agent / day cost? |

Every LLM call records: model, tokens in/out, cost USD, latency, agent, review id, span parent/child.

**BudgetGuard** reads running daily cost before each LLM call and hard-blocks when over budget.

### 5.9 Human-in-the-loop

- Approval queue for low-confidence reviews.
- Dispute flow: developer rejects a finding → stored feedback (do not auto-train on single disputes).
- Escalation for CRITICAL findings (notify channel / dashboard badge).

HITL level for v1: **human handles exceptions** (auto-handle easy cases).

### 5.10 Frontend (dashboard)

Next.js app (TypeScript):

- Review list + detail (findings, confidence, cost).
- HITL queue (approve → post / reject / edit).
- Trace viewer (timeline of events for a review).
- Economics (cost per agent, per day, per PR).

Auth: simple org allowlist or GitHub OAuth (decide in implementation step).

---

## 6. Data architecture

### Thesis

Three **shapes**, one **durable store** (Postgres + extensions):

| Shape | Content | Storage |
|-------|---------|---------|
| **Memory** | Code chunks + embeddings + FTS | `code_chunks` + pgvector (+ FTS) |
| **Truth** | Reviews, findings, HITL, GitHub ids | Relational tables |
| **Time** | Spans, LLM calls, costs | `agent_events` (plain partitioned table or Timescale hypertable) |

**Redis** remains for BullMQ only — not the system of record.

### Deployment options for the spine

| Option | When |
|--------|------|
| **Local Docker Postgres + pgvector** | Dev and early MVP |
| **Tiger Cloud / Timescale** | When hypertables + continuous aggregates matter |
| **Neon/Supabase + pgvector** | Managed Postgres alternative |

Architecture does **not** require three separate databases (Qdrant + Postgres + TSDB) for v1.

### Primary tables (logical)

```
webhook_deliveries     -- idempotency (delivery_id PK)
pr_reviews             -- one row per review attempt
findings               -- FK review_id
hitl_items             -- queue state
hitl_feedback          -- disputes / ratings
code_chunks            -- path, content, embedding, tsv
repo_file_index        -- freshness
agent_events           -- append-only timeline
```

### Dual data access (optional pattern)

- ORM (Drizzle) for normal CRUD.
- Raw SQL / `postgres.js` for bulk chunk upserts and event inserts.

---

## 7. Repository layout (monorepo)

```
PR-review-agent/
├── apps/
│   ├── api/                 # Hono/Fastify — webhooks + REST
│   ├── worker/              # BullMQ worker — orchestration
│   └── web/                 # Next.js dashboard
├── packages/
│   ├── agents/              # specialists + aggregator + contracts
│   ├── core/                # workflow engine interface, errors, config
│   ├── db/                  # Drizzle schema, migrations, repos
│   ├── github/              # Octokit client, webhook verify, models
│   ├── memory/              # embedder, hybrid retriever, ingestion
│   ├── observability/       # events, tracing helpers, budget
│   ├── prompts/             # versioned prompt templates
│   ├── reliability/         # retry, circuit breaker, timeout, idempotency
│   └── shared/              # Zod schemas, enums, types
├── docs/
│   ├── ARCHITECTURE.md      # this file
│   ├── IMPLEMENTATION.md    # step-by-step build
│   └── DECISIONS.md         # ADRs / change log
├── docker-compose.yml       # postgres+pgvector, redis
├── package.json             # pnpm workspace root
└── README.md
```

### Dependency rule

- `shared` and `core` depend on almost nothing.
- Outer packages depend inward only.
- Apps depend on packages; packages must not depend on apps.
- `observability` is cross-cutting (injected / called from agents and worker).

---

## 8. Technology choices

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | TypeScript (Node 22+) | One language API + worker + UI |
| Package manager | pnpm workspaces | Monorepo efficiency |
| API | Hono | Fast, typed, edge-friendly |
| Queue | BullMQ + Redis | Standard TS job queue |
| Orchestration (v1) | Custom graph + `Promise.all` | Simple; interface for later swap |
| Validation | Zod | Structured LLM outputs |
| LLM | OpenAI API (configurable) | Embeddings + chat; provider behind interface |
| DB | Postgres + pgvector | Single spine |
| ORM | Drizzle | SQL-first, TS-native |
| GitHub | Octokit + App auth | Production webhook model |
| Frontend | Next.js (App Router) | Dashboard |
| Logging | pino | Structured JSON logs |
| Tests | Vitest | Unit + integration |

### Explicit non-choices (v1)

- Python / LangGraph (Python)
- Separate Qdrant + ClickHouse
- Temporal (until scale requires it)
- Auto-merge bots

---

## 9. Architecture Decision Records (summary)

Full text lives in [DECISIONS.md](./DECISIONS.md).

| ID | Decision |
|----|----------|
| **ADR-001** | TypeScript monorepo instead of Python stack |
| **ADR-002** | Modular monorepo (apps + packages); extract services only when measured |
| **ADR-003** | Single Postgres spine (pgvector) for memory/truth/time; Redis for queue only |
| **ADR-004** | Simple TS orchestrator first; `WorkflowEngine` interface for LangGraph.js/Temporal later |
| **ADR-005** | Confidence-weighted HITL: human handles exceptions |
| **ADR-006** | BudgetGuard hard-blocks LLM calls over daily cap |

---

## 10. Failure modes & defenses

| Failure | Defense |
|---------|---------|
| Hallucinated finding | Grounding + rationale + confidence + HITL |
| GitHub/LLM timeout | Retry with backoff; per-node timeout; partial results |
| Orchestration hang | Timeouts; do not wait forever on one agent |
| Duplicate webhook | Idempotency key = `X-GitHub-Delivery` |
| Double-posted review | Dedup job id + check existing review for head SHA |
| Cost runaway | BudgetGuard + per-agent token limits |
| Almost-right comments | Dedup, severity filter, confidence threshold, human audit |
| Feedback poisoning | Store feedback; require evidence threshold before changing prompts/policy |
| Stale embeddings | Incremental re-index by `repo_file_index` |

**Degradation rule:** if one specialist fails, still aggregate the others and lower overall confidence (route to HITL if needed). Never invent findings to “fill the gap.”

---

## 11. Security model (high level)

- Verify all webhooks with HMAC secret.
- Never log raw private keys or webhook secrets.
- GitHub App least privilege: PR read/write comments, contents read, metadata.
- Prompt-injection hygiene: treat PR title/body/diff as untrusted input; constrain tool scope.
- Secret masking in logs and event payloads.
- Dashboard auth before HITL actions.
- RBAC: viewer vs approver roles (simple start).

Threat model document is expanded during the security implementation step.

---

## 12. Evaluation & quality gates

Without eval, the agent is a demo.

| Mechanism | Purpose |
|-----------|---------|
| Golden PR set | Known issues that must be found / must not false-positive |
| Structured scoring | Precision/recall on findings categories |
| Optional LLM-as-judge | Compare agent vs gold narrative |
| CI regression gate | Block release if metrics drop below baseline |

---

## 13. Deployment topology (target)

```
[GitHub]
   │
   ▼
[API service] ──► [Redis]
   │                 │
   │                 ▼
   │            [Worker × N]
   │                 │
   └────┬────────────┘
        ▼
   [Postgres]
        ▲
        │
   [Web dashboard]
```

- Dev: `docker-compose` + local processes (`api`, `worker`, `web`).
- Prod: same three processes (or containers); managed Postgres/Redis.

Scale path (only when measured):

1. More worker concurrency / replicas.
2. Separate API from workers (already separate processes).
3. Consider Temporal if durable multi-step workflows exceed Redis job model.

---

## 14. Config surface (env)

```bash
# Server
PORT=
NODE_ENV=

# Redis
REDIS_URL=

# Database
DATABASE_URL=

# OpenAI (or compatible)
OPENAI_API_KEY=
EMBEDDING_MODEL=
LLM_MODEL_DEFAULT=

# GitHub App
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=          # or path
GITHUB_WEBHOOK_SECRET=
GITHUB_CLIENT_ID=            # if OAuth dashboard
GITHUB_CLIENT_SECRET=

# Policy
HITL_CONFIDENCE_THRESHOLD=0.75
DAILY_BUDGET_USD=20
AUTO_POST_ENABLED=true
```

Secrets never committed; `.env.example` only.

---

## 15. Success metrics

| Metric | Why it matters |
|--------|----------------|
| Time-to-first-review | Developer wait reduction |
| Findings precision (sampled) | Trust |
| Critical recall on golden set | Safety |
| Auto-post rate vs HITL rate | Autonomy calibration |
| Cost per PR | Economics |
| Dispute rate | Quality / almost-right problem |
| Webhook p99 latency | Ingress health |
| Worker queue depth | Capacity |

---

## 16. Open questions (resolve during implementation)

1. GitHub App multi-repo vs single-repo personal install for v1?
2. Embedding dimension trade-off (cheap 256 vs full).
3. Local clone + tree-sitter chunking vs GitHub Contents API only?
4. Auto-post disabled entirely until N golden PRs pass?
5. Tiger Cloud vs plain pgvector for first deploy?

Defaults if not decided:

- Single GitHub App install for test repos.
- Smaller embedding model for cost until recall issues appear.
- GitHub API fetch of changed files + siblings first; full clone later.
- Auto-post **off** until Phase on reliability + eval baseline.
- Docker Postgres + pgvector for step 1.

---

## 17. Document map

| Doc | Role |
|-----|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design (this file) |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | Ordered build steps with green gates |
| [DECISIONS.md](./DECISIONS.md) | ADRs and change log |

---

## 18. Summary diagram (mental model)

```
L0  Selective high-value posture
L1  Four specialists (security, quality, tests, docs)
L2  Webhook trigger + Finding contract
L3  Parallel fan-out, not one mega-prompt
L4  Hybrid RAG grounding
L5  Memory / truth / time shapes
L6  agent_events spine
L7  Confidence + CRITICAL HITL gate
L8  Retries, timeouts, idempotency, dedup
    ── implemented in TypeScript monorepo ──
```

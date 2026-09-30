# Codebase Copilot — Project Specification

> Paste a GitHub URL. Get an onboarding guide to that codebase, grounded in the actual code — with every claim traceable to a file and line range.

This document is the source of truth for scope, architecture and constraints. `CLAUDE.md` holds the short working rules; this file holds the reasoning. When implementation reveals a better design, update this document (and add an ADR in `docs/decisions/`) rather than silently diverging.

---

## 1. Goals

### 1.1 Product goal

Help a developer understand an unfamiliar repository quickly:

- "Teach me how this project works."
- "How does authentication work?"
- "What happens when I call `POST /api/payments`?"
- "Which files would I touch to add refunds?"
- "Here's a GitHub issue — where should I start looking?"

The product is a **codebase onboarding tool**, not a generic "chat with your code" app and not a coding agent. It explains and locates; it does not write or modify code.

### 1.2 Portfolio goal

This is a portfolio project targeting **full-stack** and **AI engineer** roles. It should demonstrate, with evidence:

| Skill                          | Where it shows up                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Full-stack product engineering | Next.js UI with code viewer, interactive architecture map, streamed chat, job progress |
| Backend engineering            | Typed REST API, background job pipeline, relational data model, caching, rate limiting |
| Program analysis               | tree-sitter parsing, symbol extraction, import/call graphs, route detection            |
| Retrieval engineering          | Symbol-aware chunking, hybrid search, agentic tool-use retrieval                       |
| AI engineering                 | Grounded generation, server-validated citations, tool use, **measured evaluation**     |
| Machine learning               | Issue → file localization model trained on real issue/PR data, with baselines          |
| Infrastructure                 | Docker Compose locally, free-tier cloud deployment                                     |

The differentiator is **measurement**. Most "chat with your repo" projects have no evaluation. This project compares retrieval strategies and an ML model against baselines, and publishes honest numbers.

### 1.3 Non-goals

Explicitly out of scope. Do not build these unless this spec is changed:

- Code generation, code modification, or autonomous coding agents
- Test generation (needs sandboxed execution of untrusted code to be credible)
- Executing any code from indexed repositories — ever
- Private repositories / GitHub App installation (public repos only for MVP)
- Languages other than TypeScript/JavaScript (Python is a stretch goal)
- A separate vector database, a separate Python inference service, microservices, Kubernetes, Kafka
- A general "knowledge graph" module — the symbol/import/call graph in Postgres _is_ the graph
- Enterprise auth (SSO, orgs, RBAC)

---

## 2. Hard constraints

Treat these as requirements unless this document is explicitly changed.

| Area             | Constraint                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Frontend         | Next.js (App Router) + React + TypeScript + Tailwind CSS                                                |
| Backend          | Node.js + TypeScript, REST, **Fastify** + **zod** validation                                            |
| ORM              | **Prisma** — the only ORM. Raw SQL (parameterized, via Prisma) only for pgvector / full-text operations |
| Database         | PostgreSQL + **pgvector** — the only persistent store for app data and vectors                          |
| Queue / cache    | **Redis** via **BullMQ**, isolated behind an adapter                                                    |
| AI orchestration | **LangChain.js** inside the Node backend (no separate LangChain/Python server)                          |
| Parsing          | **tree-sitter** (prefer `web-tree-sitter` WASM for portable deploys)                                    |
| ML               | Trained in Python; **inference runs in Node** from an exported model artifact                           |
| Containers       | Docker + Docker Compose for local development                                                           |
| Deployment       | **Free tier, no credit card** for the initial public deployment                                         |
| LLM / embeddings | Provider-agnostic via env config; Ollama supported for local development                                |
| TypeScript       | `strict: true` everywhere; no `any` without a comment explaining why                                    |

---

## 3. Architecture

```text
                              ┌─────────────────────────────┐
                              │  Next.js (Vercel)           │
                              │  repo overview · code viewer│
                              │  architecture map · chat    │
                              │  issue locator · /eval      │
                              └──────────────┬──────────────┘
                                             │ same-origin via Next.js rewrites
                                             ▼
                              ┌─────────────────────────────┐
                              │  Fastify API (Render)       │
                              │  auth · repos · chat (SSE)  │
                              │  retrieval · ML inference   │
                              │  [worker in-process in prod]│
                              └───┬──────────┬──────────┬───┘
                                  │          │          │
                    ┌─────────────▼──┐  ┌────▼─────┐  ┌─▼──────────────┐
                    │ Postgres (Neon)│  │  Redis   │  │ LLM + embedding│
                    │ + pgvector     │  │ (BullMQ, │  │ providers      │
                    │ + tsvector FTS │  │ cache,   │  │ (configurable) │
                    │ files, symbols,│  │ rate lim)│  └────────────────┘
                    │ graph, chunks  │  └────┬─────┘
                    └────────────────┘       │
                                             ▼
                              ┌─────────────────────────────┐
                              │  Indexing worker            │
                              │  fetch tarball → filter →   │
                              │  parse → graph → chunk →    │
                              │  embed → store              │
                              └─────────────────────────────┘

   Offline (not deployed):  ml/  Python training → exported model → apps/api loads it
                            eval/ datasets + runners → results stored in Postgres → /eval page
```

**Single backend codebase, two entry points:** `server.ts` (API) and `worker.ts` (BullMQ consumer). Locally they run as separate containers. In free-tier production, `RUN_WORKER_IN_PROCESS=true` starts the worker inside the API process, because a separate background worker is typically not available on free hosting.

---

## 4. Core user flows

### 4.1 Index a repository

1. User pastes `https://github.com/{owner}/{repo}` (optionally a branch/tag/commit).
2. API validates the URL (github.com only), resolves the ref to a **commit SHA** via the GitHub REST API, and checks limits (§5.1).
3. If a `Snapshot` for that repo + SHA already exists and is `READY`, reuse it.
4. Otherwise create a `Snapshot` (`QUEUED`) and enqueue an indexing job. Return immediately.
5. UI shows live progress: `QUEUED → FETCHING → PARSING → EMBEDDING → READY` (or `FAILED` with a readable reason).

### 4.2 Onboard

On `READY`, the repo page shows the **onboarding guide** (§9): purpose, stack, architecture map, key flows, where to start reading. Every section links to code.

### 4.3 Ask

User asks a question in chat. The answer streams in with inline citations like `[1]`, each resolving to `path/to/file.ts:42-87` at the snapshot's commit. Clicking a citation opens the code viewer with those lines highlighted.

### 4.4 Trace a request

User picks a detected route (e.g. `POST /api/payments`). The system walks the call graph from the handler and produces a step-by-step flow with citations and a sequence-style diagram.

### 4.5 Locate an issue

User pastes a GitHub issue URL or text. The ML model ranks the files most likely involved, with the features that drove each score, and the user can hand the top files to chat for explanation.

---

## 5. Indexing pipeline

### 5.1 Fetching and limits

- Fetch the repo as a **tarball from the GitHub API** at the resolved SHA. No `git` binary, no clone of history.
- Use `GITHUB_TOKEN` (server-side) for higher rate limits.
- Limits (configurable, enforced while streaming):
  - Compressed archive ≤ 50 MB (`MAX_ARCHIVE_MB`)
  - ≤ 2,000 source files after filtering (`MAX_SOURCE_FILES`)
  - Individual file ≤ 200 KB (`MAX_FILE_KB`; larger files are skipped and counted)
  - Accepted files ≤ 30 MB in total (`MAX_TOTAL_SOURCE_MB`), which bounds worker memory
- The archive is **parsed as a stream in memory and never written to disk** (ADR 0003), so path-traversal and symlink entries have no filesystem to act on. They're skipped and counted, and the raw entry path is validated before GitHub's top-level folder is removed.

### 5.2 Filtering

Skip: `node_modules/`, `dist/`, `build/`, `.next/`, `coverage/`, `vendor/`, lockfiles, minified files (`*.min.js`, very long lines), source maps, binaries/images/fonts, and generated files (detect common headers like `@generated`). `.gitignore` needs no handling: GitHub archives only contain tracked files.

Index:

- **Code:** `.ts .tsx .js .jsx .mjs .cjs`
- **Docs:** `README*`, `*.md`, `docs/**`
- **Config (metadata only, not chunked for embedding):** `package.json`, `tsconfig.json`, `Dockerfile`, `docker-compose*.yml`, `.env.example`, framework configs

### 5.3 Parsing (tree-sitter)

For each code file, extract:

- **Symbols:** functions, classes, methods, interfaces, type aliases, enums, exported `const` arrow functions / React components, and exported values. Record kind, name, qualified name (`Class.method`), signature, start/end lines, exported/default flags, leading doc comment.
- **CommonJS and prototype-style definitions:** `module.exports = …`, `exports.x = …`, `var app = module.exports = {}` followed by `app.init = function () {}`, and `Foo.prototype.bar = function () {}`. Members assigned onto an object keep it as their _container_, so `this.x()` resolves to a sibling and bare `x()` never matches them.
- **Imports / exports:** module specifier, imported names, resolved target file where resolvable (relative paths, `tsconfig` `paths`, `index` files). Unresolved and external package imports are kept with the package name.
- **Call sites:** callee name and location inside each symbol.

**Call graph resolution is approximate** and must be labelled as such in the UI and docs. Resolve a call to a symbol through import bindings (following re-export chains), namespace imports, static class methods, `this.method()`, and same-file symbols; otherwise record it unresolved. Calls on local variables stay unresolved, because resolving them needs type inference. Do not claim type-accurate resolution. (A future ADR may evaluate the TypeScript compiler API for precise resolution.)

### 5.4 Route and integration detection

Deterministic detectors, each a small tested module:

- **Routes** (Milestone 3): Express/Fastify/Koa style `app|router.(get|post|put|patch|delete|all)(path, …handlers)`, including `router.route('/x').get(h)` chains and wrapped handlers (`asyncHandler(fn)`); Next.js `app/**/route.ts` and `pages/api/**`. HTTP-client calls such as `axios.get('/x', config)` are excluded. Record method, path, handler (resolved across files where possible), file, lines.

Integration and data-layer detection (Milestone 7, `src/analysis/integrations.ts`) feeds the architecture map:

- **External integrations:** from `package.json` dependencies and import sites (e.g. `stripe`, `@prisma/client`, `pg`, `redis`, `openai`, `aws-sdk`, `nodemailer`), plus env-var names referenced (`process.env.X`).
- **Data layer:** Prisma schema models, ORM model definitions, SQL migration folders.

### 5.5 Chunking

**One chunk per symbol**, not fixed line windows.

- Each chunk's embedded text = a **context header** + the code:
  ```text
  // file: src/payments/payment.service.ts
  // symbol: PaymentService.createPayment (method, exported class)
  // imports used: stripe, ../db/prisma, ./payment.types
  <code>
  ```
- Symbols larger than ~150 lines are split at statement boundaries; each part keeps the header and a `part n/m` marker.
- Top-level code not inside any symbol is grouped per file into a "module scope" chunk.
- Markdown docs are chunked by heading.
- Every chunk stores `snapshotId`, `fileId`, `symbolId?`, `startLine`, `endLine`, `content`, `embedding`, `embeddingModel`, and a generated `tsvector` for full-text search.

### 5.6 Embeddings

- Provider and model are configurable (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`); the **vector dimension is fixed in the schema**, so the choice is made once in Milestone 3 and recorded in an ADR.
- Prefer a code-capable model with **≤ 768 dimensions** to respect free database storage limits.
- Store `embeddingModel` on every chunk; retrieval must refuse to mix models.
- Batch requests, respect provider rate limits, retry with backoff, and make the embedding step **resumable** (skip chunks already embedded).

### 5.7 Failure handling

Any step can fail. The snapshot moves to `FAILED` with a user-readable `failureReason` (e.g. "Repository has 8,412 source files; the limit is 2,000.") and the internal error is logged. No stack traces reach the UI.

---

## 6. Retrieval

All strategies implement one interface so they can be swapped per request and compared in evaluation:

```ts
interface Retriever {
  name: 'vector' | 'hybrid' | 'agentic';
  retrieve(input: { snapshotId: string; query: string; k: number }): Promise<RetrievedSpan[]>;
}
// RetrievedSpan = { fileId, path, startLine, endLine, chunkId?, score, reason }
```

### 6.1 `vector`

Embed the query → pgvector cosine search (HNSW index) scoped to the snapshot → top k.

### 6.2 `hybrid` (default)

1. Vector search (top 50) and Postgres full-text search over chunk `tsvector` (top 50), with identifier-aware tokenization (split `camelCase`, `snake_case`, paths).
2. Fuse with **Reciprocal Rank Fusion**.
3. **Graph expansion:** for the top results, add closely connected symbols (callees/callers one hop, the route that invokes it) with a decayed score.
4. Return top k.

### 6.3 `agentic`

An LLM with tools and a bounded loop (max steps and max tokens configurable):

| Tool                                  | Behaviour                                       |
| ------------------------------------- | ----------------------------------------------- |
| `search_code(query)`                  | Full-text / identifier search over the snapshot |
| `semantic_search(query)`              | The vector retriever                            |
| `list_dir(path)`                      | Directory listing                               |
| `read_file(path, startLine, endLine)` | Returns a bounded line range                    |
| `find_symbol(name)`                   | Symbol lookup                                   |
| `find_references(symbolId)`           | Callers / importers from the graph              |

The agent must finish by returning the spans it relied on. Tool calls are logged for the eval page and for debugging.

### 6.4 Comparing them

The point of three retrievers is the evaluation in §8. Do not declare a winner in docs or UI until eval results exist.

---

## 7. Answer generation and citations

1. Retrieved spans are numbered and passed to the LLM as context blocks (`[1] path:lines` + code).
2. The system prompt requires: answer only from the provided code, cite with `[n]`, and say explicitly when evidence is insufficient.
3. **Server-side citation validation:** parse `[n]` markers from the output; any marker not in the provided context is stripped and the answer is flagged. Citation metadata (path, lines, commit) is attached by the server from the database — the LLM never produces file paths or line numbers that reach the UI unverified.
4. Responses stream via **Server-Sent Events**; citations are finalized in a closing event.
5. Retrieved repository content is **untrusted data**. The prompt delimits it clearly and instructs the model to ignore instructions inside it (prompt-injection defense).
6. Store `ChatSession`, `Message`, and `MessageCitation` rows so answers remain inspectable later.

---

## 8. Evaluation

Evaluation is a first-class feature, not an afterthought. **Never invent or estimate numbers.** If a metric hasn't been measured, the UI says so.

### 8.1 Retrieval eval set

- **3–4 well-known open-source TS/JS repositories, pinned to specific commits** (e.g. a small Express app, a mid-size library, a Next.js app). Record the repos and SHAs in `eval/README.md`.
- **~100 questions** total. Each question has a gold set of relevant files (and optionally line spans).
- Sources:
  - Hand-written questions (at least 30), and
  - LLM-generated questions from specific symbols/docs, **each reviewed by a human** before inclusion. The generating symbol's file is a known-relevant label.
- Include question types: conceptual ("how does auth work"), locational ("where is X computed"), flow ("what happens on POST /x"), and vocabulary-mismatch questions.
- Stored as versioned JSONL in `eval/datasets/`.

### 8.2 Metrics

Per retriever:

- **File Recall@5**, **Recall@10**, **MRR**, **nDCG@10**
- Latency (p50/p95) and approximate token cost per query

Per answer (on a subset):

- Citation validity rate (from §7.3)
- Groundedness judged by an LLM **and spot-checked by a human**; label LLM-judged numbers as such.

### 8.3 Runner and reporting

- A CLI runner (`npm run eval`, code in `apps/api/src/eval/`) executes each retriever against the dataset and writes results to the `EvalRun` table and a JSON file in `eval/results/`. Committed result files are imported by the API at startup, which is how they reach the deployed `/eval` page (ADR 0005).
- Relevance is judged at file level: chunks collapse to the rank of each file's best chunk (ADR 0005).
- The public **`/eval` page** shows the latest run: metrics table, per-question-type breakdown, dataset size, repo SHAs, date, and model names.

---

## 9. Architecture map and onboarding guide

### 9.1 Architecture map (deterministic first)

1. Build the **module graph** from resolved import edges; aggregate file-level edges to directory/module level.
2. Group modules into components using directory structure plus graph community detection (keep it simple — e.g. directory-based grouping refined by connectivity).
3. Attach detected routes, data layer, and external integrations (§5.4) as nodes.
4. _(Deferred.)_ An LLM may later name and describe the components given the deterministic structure and representative code. It must not invent nodes or edges. Milestone 7 ships the map without it (ADR 0006).
5. Render interactively in the frontend (React Flow, laid out with dagre). Every node links to its files; every edge shows the import statements that justify it.

The map is computed on first request from the stored code graph and cached per snapshot in `snapshot_analyses` with a version number, so existing snapshots need no re-indexing (ADR 0006).

### 9.2 Request tracing

From a route's handler (a named symbol, or the lines of an inline handler), BFS over resolved call edges (depth-limited, default 4, at most 40 nodes). A constructed class is followed into its constructor only. Unresolved calls are listed but not followed. An LLM narration with citations is deferred (ADR 0006).

### 9.3 Onboarding guide

Generated once per snapshot and cached (keyed by `snapshotId`):

- **Purpose** — a 2–3 sentence summary written by the LLM from the README and the deterministic facts below; the only AI-written section, labelled as such
- **Tech stack** — deterministic, from `package.json` dependencies and tooling files (Dockerfiles, tsconfig, CI workflows)
- **Architecture** — the largest components from the map above, with what they import
- **Key flows** — up to 5 routes, one per resource, linking to their traces
- **Data model** — detected schema/models
- **External integrations** and **configuration** (environment variables)
- **Where to start reading** — entry points (declared in `package.json`, conventional names, Next.js roots), files most imported by application code, and route files
- _(Deferred)_ **Glossary** — left out as the least reliable part (ADR 0007)

Each section distinguishes **deterministic facts** (stack, routes, files) from **LLM-written explanation**. The deterministic guide and the summary are cached separately in `snapshot_analyses`; a failed summary isn't cached, so it is retried on the next visit.

---

## 10. ML component: issue → file localization

### 10.1 Task

Given a GitHub issue (title + body), rank the repository's files by how likely they are to need changes to resolve it. Output: top-k files with scores and the main contributing features.

### 10.2 Data

- Collect from public TS/JS repositories: **issues closed by merged pull requests** (via `Fixes #N` / `Closes #N` links or the GitHub timeline API).
- Label: files changed by the linked PR (excluding tests, lockfiles, docs, generated files — keep a separate "including tests" variant for analysis).
- Candidate files come from the repository **at the PR's base commit** to avoid leakage from the fix itself.
- Target: several thousand issue/PR pairs across ~10–20 repos. Record the collection script, repos, date range and final counts in `ml/README.md`.
- Store raw data outside git (`ml/data/raw/`, gitignored); commit only small processed samples and the collection code.

### 10.3 Model

Learning-to-rank over candidate files:

1. **Candidate generation:** BM25 over file contents/symbol names + embedding similarity between issue text and file chunks → top ~100 files.
2. **Features** (per issue, file): BM25 score, max/mean embedding similarity, path-token overlap with issue text, symbol-name overlap, stack-trace/file-name mentions in the issue, file size, number of symbols, graph centrality, and file change frequency where available.
3. **Models:** logistic regression (baseline) and gradient-boosted trees (LightGBM or XGBoost).
4. **Baselines to beat:** BM25-only and embedding-only rankings.

### 10.4 Evaluation

- **Split by time within each repo** (train on older issues, test on newer) and additionally report a held-out-repo split.
- Metrics: **Top-1 / Top-5 / Top-10 accuracy**, **MRR**, **MAP**.
- Report results for all baselines and models in `ml/README.md` and on `/eval`. Never report training-set metrics as results.

### 10.5 Serving

- Export the chosen model to a Node-loadable format (logistic regression as a JSON weight vector; tree models as JSON dumps or ONNX via `onnxruntime-node`).
- Feature computation for inference is implemented in TypeScript in `apps/api/src/ml/` and **must match** the Python training features — enforce with shared fixture tests (same input → same feature vector in both languages).

---

## 11. Data model (Prisma)

Indicative — refine during implementation.

```text
User              id, email, passwordHash, createdAt
Repository        id, owner, name, defaultBranch, createdAt                     (unique owner+name)
TrackedRepository userId, repositoryId, createdAt                              (who can see a repo's snapshots)
Snapshot          id, repositoryId, commitSha, ref, status, failureReason?,
                  progress (json), stats (json), createdAt, startedAt?, readyAt?
                                                                                 (unique repositoryId+commitSha)
File              id, snapshotId, path, kind (CODE|DOC|CONFIG), language, sizeBytes, lineCount,
                  contentHash, content, hasErrors
Symbol            id, snapshotId, fileId, kind, name, qualifiedName, signature, startLine, endLine,
                  exported, isDefault, docComment?
ImportEdge        id, snapshotId, fromFileId, toFileId?, specifier, importedNames[], kind, line,
                  external, packageName?
CallEdge          id, snapshotId, fileId, fromSymbolId?, toSymbolId?, calleeName, calleeText, line, resolved
Route             id, snapshotId, fileId, method, path, framework, handlerName?, handlerSymbolId?,
                  startLine, endLine
SnapshotAnalysis  snapshotId, kind, version, data (json), createdAt          (cached derived analyses, e.g. the architecture map; ADR 0006)
Chunk           id, snapshotId, fileId, symbolId?, kind, startLine, endLine, content,
                embedding  Unsupported("vector(N)"), tsv Unsupported("tsvector"), embeddingModel
OnboardingGuide id, snapshotId, content (json), model, createdAt
ChatSession     id, userId?, snapshotId, createdAt
Message         id, sessionId, role, content, retriever, latencyMs, createdAt
MessageCitation id, messageId, marker, chunkId?, fileId, startLine, endLine
EvalRun         id, kind (retrieval|ml|answer), config (json), metrics (json), datasetVersion, createdAt
```

Notes:

- `vector` and `tsvector` columns use `Unsupported(...)`, so **writes and reads of those columns use parameterized raw SQL** through Prisma. Everything else uses the Prisma client.
- The HNSW and GIN indexes are created in hand-written SQL migrations; document them in the migration file.
- All code data hangs off `Snapshot`, so answers are always tied to one commit and never mix versions.
- Commits are immutable, so **one snapshot per commit is shared by every user** who adds that repository; `TrackedRepository` controls visibility (404 for everyone else).
- The embedding model is recorded on chunks (Milestone 4), not on the snapshot.
- Storing `File.content` in Postgres is intentional: it powers the code viewer and `read_file` tool without a separate object store. The file limits in §5.1 keep this within free storage.

---

## 12. Redis responsibilities

Redis is behind `src/lib/redis/` adapters so it can be replaced or reduced.

1. **Indexing queue** (BullMQ): one job per snapshot, with progress updates, retries with backoff, and a concurrency of 1–2.
2. **Cache**, always keyed by `snapshotId` (never by repo name alone): retrieval results, onboarding guide fragments, identical chat questions.
3. **Rate limiting**: per-IP and per-user limits on chat, indexing and issue-locate endpoints; stricter limits for anonymous demo users.
4. **Progress state** for live indexing status.

Free hosted Redis often limits commands per day/month and BullMQ polls continuously — tune BullMQ (`drainDelay`, stalled-check intervals) and measure command usage before relying on a free plan.

---

## 13. API

Built so far (✓) and planned. "public" means readable without a session for demo repositories.

```text
✓ POST   /api/auth/register | /login | /logout
✓ GET    /api/auth/me

✓ POST   /api/repos                            { url } → { snapshot }   (URL may include /tree/<ref>)
✓ GET    /api/repos                            the user's tracked repositories + latest snapshot
✓ GET    /api/demo                             demo repositories (public)
✓ GET    /api/snapshots/:id                    status, progress, stats            (public for demos)
✓ GET    /api/snapshots/:id/routes             detected routes + handlers         (public for demos)
✓ GET    /api/snapshots/:id/files              file list                          (public for demos)
✓ GET    /api/snapshots/:id/file?path=         file content + symbol outline      (public for demos)
✓ POST   /api/snapshots/:id/chat               { message, sessionId? } → SSE      (public for demos)
✓ GET    /api/snapshots/:id/chat/sessions      the user's conversations
✓ GET    /api/chat/sessions/:sessionId         messages + validated citations
✓ POST   /api/snapshots/:id/search             { query, retriever?, k? }          (public for demos)
✓ GET    /api/snapshots/:id/architecture       components, imports, integrations  (public for demos)
✓ GET    /api/snapshots/:id/routes/:routeId/trace   call tree from the handler   (public for demos)
✓ GET    /api/snapshots/:id/guide              deterministic onboarding guide     (public for demos)
✓ GET    /api/snapshots/:id/guide/summary      AI summary, cached per snapshot    (public for demos)
✓ GET    /api/eval/latest                      newest retrieval evaluation run   (public)

  POST   /api/snapshots/:id/locate-issue       { issueUrl | title+body }          (Milestone 8)

✓ GET    /api/health                           dependency status (503 if degraded)
✓ GET    /api/health/live                      liveness for the hosting platform
```

Chat SSE events, in order: `session`, `sources`, `token`…, `done` (final text with invalid citation markers removed, validated citations, `flagged`), or `error` at any point.

All inputs validated with zod. Shared request/response types live in `packages/shared`.

---

## 14. Frontend

Pages:

```text
/                         landing: what it does + demo repos (no login needed)
/login, /register
/repos                    my repos + demo repos
/repos/[snapshotId]       onboarding guide (default tab) + index statistics
   /architecture          interactive architecture map
   /routes?route=<id>     route list + request tracing
   /code?path=&lines=     file tree + code viewer (syntax highlighting, line anchors)
   /chat                  streamed chat with clickable citations
   /issues                issue locator (Milestone 8)
/eval                     public evaluation results
```

UX requirements:

- A citation click opens the code viewer at the exact lines, highlighted, with the commit SHA visible.
- Indexing progress updates live.
- A "waking up the server…" state handles free-tier cold starts gracefully.
- Deterministic facts and AI-written text are visually distinguished.
- Works at phone width (read-only is acceptable on small screens).

---

## 15. Authentication and demo mode

- Email/password with a slow hash (argon2 or bcrypt), JWT in an **httpOnly, Secure, SameSite=Lax cookie**.
- The frontend calls the API **through Next.js rewrites** so the browser sees one origin and the cookie works despite separate hosts.
- **Demo mode:** a set of pre-indexed public repos is viewable and chattable **without an account**, with strict rate limits. Indexing new repos requires an account.
- Authorization: users can see their own snapshots and all demo snapshots. Snapshots of the same public repo+commit may be shared across users (the code is public), but chat sessions are private.

---

## 16. Deployment (free, no credit card)

| Component                 | Preferred                                   | Notes                                                      |
| ------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Frontend                  | Vercel                                      |                                                            |
| API (+ in-process worker) | Render free web service                     | Sleeps when idle; cold starts; limited RAM                 |
| Postgres + pgvector       | Neon free                                   | Small storage limit — hence dimension and repo-size limits |
| Redis                     | Upstash free                                | Command limits — see §12                                   |
| LLM / embeddings          | A provider with a free tier; Ollama locally | Behind `LLMService` / `EmbeddingService`                   |

Before deploying, **verify current free-tier limits and card requirements** for every provider and record them in `docs/deployment.md` with the date checked. Never silently introduce a paid dependency.

Tree-sitter grammars (WASM), the ML model artifact and embeddings for demo repos must fit within the API's memory budget; measure memory in Milestone 4.

---

## 17. Security

- **Never execute repository code**: no `npm install`, no build, no scripts, no evaluating config files. Repos are data.
- Accept only `https://github.com/{owner}/{repo}` URLs; build GitHub API URLs server-side (no user-controlled fetch targets → no SSRF).
- Safe tarball extraction: size caps, file-count caps, no path traversal, no symlinks.
- Treat retrieved code and issue text as untrusted in prompts (§7.5).
- Secrets only in env vars; `.env*` gitignored except `.env.example`; nothing private exposed via `NEXT_PUBLIC_*`.
- Validate all API input; enforce ownership on every snapshot/session access.
- Rate-limit all LLM-backed endpoints before any public deploy.
- Logs never contain passwords, tokens, API keys, or full file contents.

---

## 18. Observability and errors

- Structured JSON logging (pino). Log request id, route, user id (where safe), snapshot id, job stage transitions, retrieval latency, LLM latency and token counts, errors.
- User-facing errors are short and actionable; internal details go to logs only.
- Handle: invalid URL, repo not found/private, over limits, GitHub rate limit, parse failure on individual files (skip and record, don't fail the job), embedding/LLM timeouts and rate limits (retry with backoff), Redis unavailable (degrade: no cache; queue failure surfaces as a clear error), DB errors.

---

## 19. Testing

- **Unit:** URL validation, filtering rules, tree-sitter symbol/import/call extraction (fixture repos in `apps/api/tests/fixtures/`), route detectors, chunker, RRF fusion, citation parsing/validation, ML feature computation.
- **Integration:** indexing a small fixture repo end-to-end against Postgres in Docker; retrieval on the fixture; auth and authorization.
- **Cross-language:** Python vs TypeScript feature parity fixtures for the ML model.
- **Frontend:** critical flows (index → guide → chat → citation click) with Playwright where practical.
- CI (GitHub Actions): typecheck, lint, unit + integration tests on every push/PR.

---

## 20. Repository layout

```text
codebase-copilot/
├── apps/
│   ├── web/                 Next.js frontend
│   └── api/                 Fastify API + worker
│       ├── prisma/          schema.prisma, migrations/
│       ├── src/
│       │   ├── config/      env parsing (zod)
│       │   ├── routes/      thin HTTP handlers
│       │   ├── services/    business logic
│       │   ├── repositories/ data access (Prisma + raw SQL for vectors)
│       │   ├── indexing/    fetch, filter, parse, graph, chunk, embed
│       │   ├── retrieval/   vector, hybrid, agentic
│       │   ├── llm/         LLMService, EmbeddingService, prompts
│       │   ├── analysis/    routes, integrations, architecture, tracing, guide
│       │   ├── ml/          feature computation + model inference
│       │   ├── lib/         redis, queue, logger, errors
│       │   ├── server.ts
│       │   └── worker.ts
│       └── tests/
├── packages/
│   └── shared/              shared types and zod schemas
├── ml/                      Python: data collection, training, evaluation, export
├── eval/                    datasets (JSONL) + runners
├── docs/
│   ├── SPEC.md              this file
│   ├── decisions/           ADRs (one file per significant decision)
│   └── deployment.md
├── docker-compose.yml
├── .env.example
├── CLAUDE.md
└── README.md
```

npm workspaces for the monorepo. Keep business logic out of route handlers.

---

## 21. Milestones

Each milestone ends with working, tested, committed code. Tests are written alongside features, not saved for the end.

| #   | Milestone                                     | Definition of done                                                                                                                                                                                          |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Foundation**                                | Monorepo, Docker Compose (Postgres+pgvector, Redis), Fastify + Next.js running, Prisma migrations, env validation, CI, logging                                                                              |
| 2   | **Auth**                                      | Register/login/logout, cookie JWT through Next.js rewrites, ownership middleware, tests                                                                                                                     |
| 3   | **Ingestion + parsing**                       | URL → SHA → tarball → filter → tree-sitter symbols/imports/calls/routes stored; BullMQ job with live progress; failure states; fixture tests                                                                |
| 4   | **Chunks, embeddings, chat — vertical slice** | Symbol chunks, embeddings (ADR for model/dimension), hybrid retriever, streamed chat with validated citations, code viewer with line highlighting. **Deploy to free tier with demo repos and rate limits.** |
| 5   | **Evaluation harness**                        | Eval dataset (~100 Qs, 3–4 pinned repos), runner, vector vs hybrid metrics, `/eval` page                                                                                                                    |
| 6   | **Agentic retriever**                         | Tool-use retriever with bounded loop; included in eval; results published                                                                                                                                   |
| 7   | **Architecture + tracing**                    | Module graph, component grouping, integrations, interactive map, request tracing                                                                                                                            |
| 8   | **Issue localization (ML)**                   | Data collection, features, baselines, LR + GBDT, time-split eval, exported model served in Node, parity tests, issue locator UI                                                                             |
| 9   | **Onboarding guide**                          | Generated per snapshot, cached, deterministic vs generated sections distinguished                                                                                                                           |
| 10  | **Polish**                                    | README with architecture diagram, demo GIF/video, eval results, `docs/deployment.md`, security pass                                                                                                         |
| —   | _Stretch_                                     | Python support; Semgrep-based security findings explained with repo context; incremental re-indexing between commits; GitHub OAuth                                                                          |

**Milestone 5 status (2026-09-30):** the harness (dataset format, metrics, runner, `/eval` page, search endpoint) is built and tested, but no run was published: the v1 questions were LLM-drafted and the owner chose not to publish results from them (ADR 0005). Milestone 6's comparison against hybrid search would need a dataset the owner is happy to publish.

---

## 22. Resume statement (only after it's true)

Fill in real numbers only after they are measured:

> Built Codebase Copilot, a codebase-onboarding platform (Next.js, Node/TypeScript, PostgreSQL/pgvector, Redis, LangChain) that parses repositories with tree-sitter into a symbol and call graph. Benchmarked embedding RAG vs hybrid vs agentic tool-use retrieval (file Recall@5: __ → __) and trained an issue-to-file localization model on __ real issue/PR pairs (Top-5 accuracy __ vs __ BM25 baseline).

---

## 23. Decision rules

When choosing between approaches, prefer the one that:

1. Keeps the project deployable on free infrastructure
2. Has fewer moving parts
3. Is deterministic where determinism is possible (LLMs explain; they don't detect or locate on their own)
4. Can be measured
5. Is easier to explain in an interview

Record significant decisions as ADRs in `docs/decisions/NNNN-title.md` (context, decision, alternatives, consequences).

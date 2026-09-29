# 0003: Repository ingestion and the code graph

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Milestone 3 turns a GitHub URL into a stored code graph (files, symbols, imports, calls, routes) for one commit. It has to be safe with untrusted archives, fit a 512 MB free-tier instance, stay inside free Redis command limits, and tolerate retries and worker restarts.

## Decisions

### Fetching

- **Tarball from the GitHub API at a resolved commit SHA**, with no `git` binary and no history. The API resolves the URL's ref to a SHA when the repository is added, so the snapshot is pinned before any work starts.
- **Only GitHub URLs are accepted, and API URLs are built on the server.** Nothing the user sends becomes a fetch target, which rules out SSRF.
- `GITHUB_TOKEN` is optional. Without it GitHub allows 60 requests/hour per IP, which a demo exhausts quickly (we hit it during development). Adding a repository costs 2 requests and indexing costs 1.

### Extraction (a change from SPEC §5.1)

- **The archive is parsed as a stream in memory and never written to disk.** The spec originally planned a temp directory with path-traversal checks. Without a disk, `../`, absolute-path and symlink entries have nothing to act on; they're skipped and counted. The raw entry path is also validated _before_ GitHub's top-level folder is stripped, since stripping first let `/etc/x` slip through as `etc/x` (a test caught this).
- Limits are enforced while streaming: 50 MB compressed, 200 KB per file, 30 MB of accepted files in total (which bounds memory), and 2,000 source files. Exceeding a limit fails fast with a message the user can act on.
- The source-file limit is counted **after** content checks, so generated and minified files don't use it up.

### Parsing

- **`web-tree-sitter` (WASM)** with the TypeScript, TSX and JavaScript grammars from their npm packages. There's no native build, so the same code runs locally, in Docker and on free hosts. Grammars load once per process, and every tree is `delete()`d after use because WASM memory isn't garbage-collected.
- One parse per file feeds symbol, import, call and route extraction.
- **CommonJS and prototype patterns are first-class.** Indexing `expressjs/express` with only ESM-style extraction found 55 symbols. Adding `module.exports`, `exports.x` and `obj.method = function` support raised that to 145, and resolved calls went from 278 to 411.

### Resolution

- Module resolution mirrors TypeScript and bundlers: extension and `index` probing, `./x.js` → `x.ts`, tsconfig `paths`/`baseUrl` through relative `extends`, and workspace packages from `package.json` files in the repo.
- **Call resolution is name-based and conservative.** It resolves through import bindings, re-export chains, namespace imports, static methods, `this.x()` and same-file names. Calls on local variables (`const s = new Service(); s.run()`) stay unresolved. Resolving them would need type inference, and a guessed edge is worse than a missing one when the graph grounds LLM answers later. (The TypeScript compiler API is the upgrade path if this becomes the bottleneck.)
- Routes whose handler is defined in another file are linked through the same resolver.

### Jobs

- **BullMQ with one job per snapshot, whose job id is the snapshot id**, so double submissions don't index twice. A finished job is removed before a snapshot is re-queued.
- **Progress lives in Postgres** (`snapshots.progress`), not Redis. The UI polls one row, it survives restarts, and Redis only holds the queue.
- **Failures are split in two.** Ones the user can act on (limits, repository gone, no JS/TS) mark the snapshot `FAILED` immediately and throw `UnrecoverableError`, so no retries are wasted. Transient ones show "retrying" and fail with a generic message only on the final attempt (3 attempts, exponential backoff).
- **Jobs are safe to re-run.** Saving deletes the snapshot's previous rows first, so retries and stalled-job recovery never duplicate data.
- **Free Redis limits:** the worker waits 30 s between empty polls (default 5 s) and checks for stalled jobs every 2 minutes (default 30 s).
- The worker is a separate process (`worker.ts`, its own Compose service). `RUN_WORKER_IN_PROCESS=true` runs it inside the API on hosts without background workers.

### Sharing and access

- **One snapshot per commit is shared by all users.** Commits are immutable and the repositories are public, so indexing the same commit twice would only waste resources. `tracked_repositories` decides who sees what, and everyone else gets 404.

## Measurements (local Docker, 2026-09-29)

| Repository        | Code files | Symbols | Resolved calls | Routes                      | Time                              |
| ----------------- | ---------- | ------- | -------------- | --------------------------- | --------------------------------- |
| expressjs/express | 141        | 145     | 411 / 11,312   | 255 (all in tests/examples) | 4.7 s                             |
| honojs/examples   | 43         | 61      | 32 / 449       | 43                          | 2.1 s                             |
| sindresorhus/ky   | 87         | 223     | 1,087 / 10,357 | 519 (all in tests)          | 2.8 s                             |
| vercel/next.js    | —          | —       | —              | —                           | rejected: over 2,000 source files |

The worker peaked at about 250 MB and the API at about 110 MB.

The resolved-call ratio is low by design: most call sites target built-ins, packages, test helpers or local variables. It isn't a quality metric. Retrieval quality is measured in Milestone 5.

## Consequences

- Monorepos and large frameworks over 2,000 source files are rejected. Raising the limit mostly costs memory (files are held in memory) and Neon storage (file content is stored).
- Route detection is heuristic. Frameworks it doesn't know (NestJS decorators, tRPC routers) show no routes yet.
- Test and example routes dominate framework repositories, so the UI collapses them under application routes.

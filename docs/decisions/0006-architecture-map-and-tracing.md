# 0006: Architecture map and request tracing

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

Milestone 7 adds an architecture map (SPEC §9.1) and request tracing (§9.2). Everything they need (files, symbols, resolved imports, call edges and routes) is already stored per snapshot by the indexer (ADR 0003).

## Decision

**Deterministic only, for now.** The map and traces are built from the parsed code graph. The spec's LLM parts (naming and describing components, narrating a trace) are deferred: they would spend the same free Gemini quota that chat and evaluation need, and the deterministic output is already readable because components are named after their directories.

**Components are directories.** `src/analysis/components.ts` skips wrapper folders that hold everything (`src/`), starts at the next level, and repeatedly splits the largest folder into its subfolders while it holds more than 35% of the source files (and more than 8), stopping at 12 components. Tests, examples and tooling are recognized by path and grouped separately, hidden by default in the UI. Graph community detection was considered and left out: directory grouping is predictable, and a developer can check it at a glance.

**Edges carry evidence.** An edge is the count of resolved imports from one component to another, with up to five example import statements (file, line, specifier). Imports are resolved by path (ADR 0003), so these edges are exact. Integration edges come from imports of a curated list of known packages (databases, payments, email, auth, AI, storage, and so on); unknown packages are treated as libraries, not services.

**Computed lazily and cached.** Instead of a new indexing stage and an `Integration` table, the map is computed on first request and stored in `snapshot_analyses` (`snapshotId`, `kind`, `version`, `data`). Commits are immutable, so a cached map only goes stale when the analysis code changes, which bumps `ARCHITECTURE_VERSION`. Snapshots indexed before Milestone 7, including the live demos, get maps without re-indexing. Computing one takes 7–42 ms on the demo repositories.

**Tracing is breadth-first over resolved calls.** From a route's handler symbol, or the line range of an inline handler (minus the registration call itself), the trace follows resolved call edges up to depth 4 and 40 nodes. A `new Foo()` call resolves to the class, so the trace follows only the class's constructor rather than every method in the class body. Call resolution is name-based and approximate (SPEC §5.3), so unresolved calls are shown as such and never guessed. The endpoint is a plain `GET` returning JSON rather than the SSE stream the spec planned, since there is no narration to stream.

## Consequences

- The map explains structure (who imports whom), not runtime behavior; the UI says so.
- Directory-based components can be misleading in repositories organized by file type rather than feature, but each component lists its files, so the grouping is inspectable.
- Adding the LLM descriptions or narration later is additive: a new analysis kind in `snapshot_analyses`, or an SSE endpoint that takes the deterministic trace as its sources.

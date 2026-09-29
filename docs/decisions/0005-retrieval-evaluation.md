# 0005: Retrieval evaluation design

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Milestone 5 compares retrieval strategies with measured numbers (SPEC §8). The choices below decide what those numbers mean, so they are fixed before the first published run.

## Decision

**Unit of relevance: files.** Questions are labelled with the files that answer them, not line ranges. File labels are quicker to review, stable across chunking changes, and match what a developer needs first ("which files do I read?"). Chunks are collapsed to files at the rank of each file's best chunk. Line-level labels can be added later without invalidating file-level results.

**Metrics:** Recall@5, Recall@10, MRR and nDCG@10 with binary relevance, averaged over questions, plus a breakdown by question type and by repository. Recall@5 is the headline number because chat puts the top chunks in the prompt: a file that isn't retrieved can't be cited.

**Retrievers compared:** `vector`, `fulltext`, `hybrid (no graph)` and `hybrid`. The fusion-only variant separates what Reciprocal Rank Fusion adds from what the call-graph hop adds.

**Latency is measured without the query embedding.** Each question is embedded once, before any retriever runs, and the embedding time is reported separately. Otherwise vector and hybrid would each pay a network call of variable length, and the comparison would mostly measure the embedding API.

**Pinned repositories, indexed locally.** Four public repositories pinned to full SHAs (see `eval/README.md`), chosen to cover a small TypeScript API, a CommonJS library, a mid-size ES-module library and a Next.js app. The runner indexes them into the local database with the production indexer; they are never tracked by a user, so they don't appear in the app.

**LLM-drafted questions, disclosed as not checked by a person.** The spec asked for at least 30 human-written questions plus LLM-generated ones reviewed by a person. v1 has 98 questions drafted by an LLM that read each answer file, written before any retriever ran on them; every gold path is checked to exist at the pinned commit. No human review was done for v1, so `/eval` states that the questions have not been checked by a person. Every question carries `source` and `reviewed`, and the manifest can record a later human check (`review`), which `/eval` then publishes with every run.

_Alternatives considered:_ a human review of every question or of a seeded random sample (stronger evidence that the labels are right; still possible as a later dataset revision).

**Results reach production as committed files.** A run writes `eval/results/<date>-<id>.json` and a row in `eval_runs`. The API imports committed result files at startup (skipping runs it already has), so publishing a run is a commit and a deploy, and no production database credentials are needed locally. `GET /api/eval/latest` serves the newest run.

**Embedding is resumable.** The free Gemini tier rate-limits bulk embedding per minute. The runner parses each repository once, then embeds only chunks without a vector from the configured model, in batches of 20 with patient retries, saving as it goes (`embedMissingChunks`).

## Consequences

- Numbers are only comparable within one dataset version (`v1+<hash>`); editing questions means rerunning every retriever.
- File-level Recall can credit a retriever that found the right file but the wrong function. Line-level evaluation is future work.
- Answer quality (groundedness and citation validity, SPEC §8.2) is not part of this decision and is reported as "not measured yet".
- The LLM-drafted questions were written by reading the code, so they may use the code's own vocabulary more than real users do. The `vocabulary` type exists to measure the opposite case, and human-written questions should be added over time.

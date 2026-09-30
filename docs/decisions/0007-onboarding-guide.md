# 0007: Onboarding guide

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

Milestone 9 adds a per-repository onboarding guide (SPEC §9.3): what the project is, what it's built with, where to start reading, and its key flows. The architecture map and traces (ADR 0006) already provide most of the facts. The open questions were how much of the guide an LLM should write, and how to keep its cost bounded on the free Gemini tier.

## Decision

**Facts from the code; one AI-written paragraph.** Everything except the opening summary is deterministic: the tech stack (known dependencies and tooling files, each linked to the file that shows it), files to start reading, key request flows, the largest components, data models, external services and environment variables. The summary (2–3 sentences) is the only LLM output. It is written from the README and those facts, labelled "AI-written" in the UI, and the page says that everything else comes from the parsed code.

**Where to start reading** ranks application files by: entry points declared in `package.json` (`main`, `module`, `bin`); conventional entry names near the root (`index`, `main`, `server`, `app`) and Next.js roots; how many application files import them (imports from tests don't count, or `index.js` in a library wins by a landslide); and how many routes they define.

**Key flows** are one route per resource (the first path segment), busiest resources first, preferring handlers with the most resolved calls, then writes over reads. Each links to its trace.

**Two cached analyses.** The deterministic guide and the summary are stored separately in `snapshot_analyses` with their own versions. The summary is generated on first view (the guide renders immediately with a skeleton in its place), shared between concurrent visitors so it costs one model call per snapshot, and not cached when the model fails, so a later visit retries. Without an API key, the guide works and says the summary isn't configured.

**Glossary deferred.** Domain terms generated from symbol names were the least reliable part of the spec'd guide and would add a second model call; left out.

**The guide replaces the overview.** It is the default repository tab. Index statistics stay below it; the routes table, which duplicated the Routes tab, was removed.

## Consequences

- The summary can still be wrong about intent (it sees the README, not the product), which is why it's labelled and kept short.
- Changing the ranking or stack detection means bumping `GUIDE_VERSION`; changing the prompt means bumping `SUMMARY_VERSION`.
- Repositories without routes (libraries) get a guide without key flows; the section says so rather than inventing entry points.

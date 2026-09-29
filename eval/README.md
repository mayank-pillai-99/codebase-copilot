# Retrieval evaluation

This directory holds the benchmark behind the public `/eval` page (SPEC §8). It measures how often each retrieval strategy finds the files that answer a question about a codebase.

```text
eval/
├── datasets/v1/
│   ├── repos.json        repositories, each pinned to a full commit SHA
│   └── questions.jsonl   one question per line, with its answer files
├── results/              committed runs (JSON), imported by the API at startup
└── drafts/               runs over unreviewed questions (gitignored, never published)
```

The runner lives in `apps/api/src/eval/` because it uses the API's retrievers directly.

## Repositories (v1)

| Repository                                                                                                                                                        | Commit    | Why it's here                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------- |
| [gothinkster/node-express-realworld-example-app](https://github.com/gothinkster/node-express-realworld-example-app/tree/30b68e1e881462b2f4164ea09ab4c4f5699c7b0b) | `30b68e1` | Small Express + Prisma API in TypeScript                      |
| [expressjs/express](https://github.com/expressjs/express/tree/7ef98448f8b38099ab1ded55e458538ad47a51e7)                                                           | `7ef9844` | Framework library in CommonJS, with many small example apps   |
| [axios/axios](https://github.com/axios/axios/tree/2426e03ba9020be31ed013873423cea6b7cd2e67)                                                                       | `2426e03` | Mid-size library; about 2,600 chunks including tests and docs |
| [shadcn-ui/taxonomy](https://github.com/shadcn-ui/taxonomy/tree/298a8857c7128a0d121e7f699dfd729f23b3966d)                                                         | `298a885` | Next.js App Router app: NextAuth, Prisma, Stripe, MDX         |

Tests, docs and examples are indexed as usual. They are realistic distractors: a retriever has to find the implementation, not a test that mentions it.

## Questions

Each line of `questions.jsonl`:

```json
{
  "id": "rw-02",
  "repo": "gothinkster/node-express-realworld-example-app",
  "type": "locational",
  "question": "Where are user passwords hashed?",
  "gold": ["src/app/routes/auth/auth.service.ts"],
  "source": "llm-drafted",
  "reviewed": true
}
```

- **type**: `conceptual` ("how does auth work?"), `locational` ("where is X done?"), `flow` ("what happens on POST /x?"), or `vocabulary` (phrased without the words the code uses).
- **gold**: every file needed to answer the question, as paths at the pinned commit. The runner fails if a path doesn't exist in the indexed snapshot.
- **source**: `human` for questions a person wrote; `llm-drafted` for questions an LLM drafted after reading the code.
- **reviewed**: true when a person checked this question (it was in the review sample, or they wrote it).

### Who checked the questions

All v1 questions were drafted by an LLM (Claude) after reading each file it lists as an answer, and every gold path is verified to exist at the pinned commit. **They have not been checked by a person**, and `/eval` says so with every run. Questions were written before any retriever was run on them, and nothing was changed afterwards to suit a retriever.

If a person checks them later (all of them, or a seeded random sample), record the outcome in `repos.json` as `review` (`method`, `seed`, `sampled`, `kept`, `edited`, `dropped`); `/eval` then publishes it with every run. Reviewers should not see retriever results while checking, so the labels can't drift toward what a retriever happens to find.

The dataset version in results is `v1+<hash of questions.jsonl>`, so any edit to the questions shows up in the results.

## Metrics

Retrievers return chunks (usually one function or class each). For each question the chunks are collapsed into a ranked list of distinct files; a file ranks where its best chunk ranks. Relevance is binary.

- **Recall@k**: share of the gold files in the top k files.
- **MRR**: mean of 1 / rank of the first gold file (0 if none is found).
- **nDCG@10**: discounted gain of gold files in the top 10, divided by the gain of an ideal ordering.
- **Latency**: p50 and p95 database time per question. Query embeddings are computed once, up front, and reported separately, so vector and hybrid share identical vectors and their latencies compare fairly.

Every retriever is asked for 20 chunks (`--k`), enough to fill ten distinct files in practice.

Retrievers compared: `vector`, `fulltext`, `hybrid (no graph)` (fusion only), and `hybrid` (fusion plus one call-graph hop, which is what chat uses).

## Running it

```bash
npm run infra:up
GITHUB_TOKEN=$(gh auth token) npm run eval              # → eval/results/ + database
GITHUB_TOKEN=$(gh auth token) npm run eval -- --draft   # trial run → eval/drafts/ only
```

The first run downloads and indexes each repository into the local database, then embeds its chunks with `GEMINI_API_KEY`. The free Gemini tier rate-limits bulk embedding per minute, so this takes a while; embeddings are saved batch by batch and a stopped run resumes where it left off.

A normal run writes `eval/results/<date>-<id>.json` and an `eval_runs` row. Commit the JSON file: the API imports it at startup, which is how results reach the deployed `/eval` page.

## Rules

- Never edit numbers in a result file, and never publish a draft run.
- Don't tune retrievers against individual questions. If a retriever changes after a run, rerun the whole dataset and keep the old result file for comparison.
- Adding or editing questions changes the dataset version; rerun every retriever on the new version rather than mixing versions.

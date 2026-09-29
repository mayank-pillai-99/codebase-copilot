# 0004: Embedding model, vector dimension and retrieval storage

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Milestone 4 adds semantic search and grounded chat. The vector dimension is fixed in the database schema, so the embedding model has to be chosen before any data is written. Changing the model later means re-embedding every snapshot. Constraints: free tier, no credit card (SPEC §2), and small database storage (Neon free tier).

## Decision

**Provider:** Google Gemini for both embeddings and chat, using one AI Studio API key. The free tier needs no credit card or billing account, per Google's billing docs as checked on 2026-09-29.

**Embedding model:** `gemini-embedding-2` at **768 dimensions**.

- The model uses Matryoshka representation learning, so shorter outputs keep most of their quality. Google lists 768, 1536 and 3072 as the recommended sizes, and truncated vectors come back already normalized.
- 768 × 4 bytes ≈ 3 KB per chunk before indexing, a quarter of the 3072-dimension default. That matters with 0.5 GB of free storage.
- The model takes task instructions in the text instead of a `task_type` field. Queries are sent as `task: code retrieval | query: …`, and chunks as `title: <file · symbol> | text: …`.
- LangChain's `GoogleGenerativeAIEmbeddings` doesn't expose the output dimension, so we implement LangChain's `Embeddings` interface ourselves on top of Gemini's REST `batchEmbedContents`. Chat uses LangChain's `ChatGoogleGenerativeAI`.

**Alternatives considered:**

- _Voyage `voyage-code-3`_: code-specialized, but usable rate limits require a payment method.
- _Groq for chat_: very fast, but the free tier's ~8K tokens per minute allows roughly one RAG answer per minute.
- _Local models (Ollama, transformers.js)_: no key and no data sharing, but the free hosting tier has too little CPU and memory to embed thousands of chunks.

**Storage:**

- `chunks.embedding vector(768)` with an **HNSW** index (`vector_cosine_ops`). Queries filter by snapshot, so they enable pgvector 0.8's iterative index scans to keep returning `k` results after filtering.
- `chunks.tsv` is a **generated** `tsvector` over `search_text` (content plus identifiers split into words), using the `simple` configuration so identifiers aren't stemmed. It has a GIN index.
- Each chunk records `embedding_model`, and retrieval refuses to compare vectors from different models.

**Prisma limitation:** Prisma can declare the GIN index and the generated column, but not HNSW indexes. It therefore always proposes dropping `chunks_embedding_hnsw_idx`. `npm run db:check-drift` (run in CI) fails on any schema difference _except_ that one, so the index can't be dropped by accident.

## Consequences

- On the free tier, Google may use submitted content to improve its products. The repositories are public, but chat questions are also sent.
- Free-tier rate limits bound indexing speed and chat volume. The embedding step batches requests and backs off on 429 responses, and chat is rate-limited per user and per IP.
- Without `GEMINI_API_KEY`, indexing still finishes: chunks are stored without embeddings, search uses full-text search only, and chat reports that it isn't configured.
- Switching embedding models means re-indexing. Mixing models inside a snapshot is prevented by the recorded `embedding_model`.

## Live measurements (2026-09-29, free tier)

Measured with a real AI Studio key against the `gothinkster/node-express-realworld-example-app` demo (39 source files, 75 chunks):

| Step                                                     | Result                                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Index + embed (75 chunks)                                | 4.7 s                                                                                                             |
| Index + embed `honojs/examples` (114 chunks) right after | 151 s: the embedding client backed off on per-minute limits and finished without intervention                     |
| Embedding sanity check                                   | "how do users sign in?" scored 0.731 against `login` vs 0.634 against `charge`                                    |
| Chat, first token / full answer                          | 3.4 s / 4.5 s typical; the main model sometimes stalled for 10–25 s                                               |
| Grounding                                                | Cited lines matched the code; asked about Stripe, the model said the code doesn't mention it rather than guessing |

**What changed because of it:** free-tier chat models are often overloaded, and not always with a fast 503. Sometimes they stall long enough (over 30 s) for proxy idle timeouts to close the stream. Chat now:

- tries `LLM_FALLBACK_MODELS` when the main model is overloaded, rate-limited, or gives no first token within 15 s
- turns off LangChain's own retries, so a hand-over takes seconds, not a minute
- sends SSE heartbeat comments every 10 s so no proxy closes a slow stream

**Account issue seen during setup:** a key from one AI Studio project returned `403 PERMISSION_DENIED: "Your project has been denied access"` for every model call, although listing models worked. A key created in a _new project_ worked immediately. The app handles this state without crashing: indexing completes with full-text search only, and chat reports that the provider rejected the request.

## Update: chat no longer uses LangChain's Gemini integration (2026-09-29)

In production, `@langchain/google-genai` failed with `[GoogleGenerativeAI Error]: Failed to parse stream`. It's built on Google's **deprecated** `@google/generative-ai` SDK, which also left a promise unobserved, so the failure crashed the whole API process through an unhandled rejection.

Chat now uses `GeminiChat`, our own LangChain `BaseChatModel` subclass over the REST `streamGenerateContent?alt=sse` endpoint. So chat still goes through LangChain's interface, as embeddings already did. It parses server-sent events itself: a CRLF split across network chunks broke our first version, and a byte-sliced test now covers it. It skips "thought" parts and reports errors with their HTTP status, so 503 overloads trigger the model fallback. Both entry points also log stray unhandled rejections instead of exiting, so one bad client can't take down in-flight requests and indexing jobs.

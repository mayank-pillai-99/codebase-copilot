# Deploying on free tiers

Codebase Copilot runs on four free services, none of which needs a credit card for this setup:

| Piece                      | Service                               | What runs there                                                     |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| Web app                    | **Vercel** (Hobby)                    | Next.js; proxies `/api/*` to the API so the browser sees one origin |
| API + indexing worker      | **Render** (Free web service, Docker) | Fastify API with `RUN_WORKER_IN_PROCESS=true`                       |
| Database                   | **Neon** (Free)                       | PostgreSQL with pgvector                                            |
| Queue, rate limits, quotas | **Upstash** (Free Redis)              | BullMQ jobs and counters                                            |
| AI                         | **Google AI Studio** (Free tier)      | `gemini-embedding-2` embeddings and Gemini Flash chat               |

> **Verify before you deploy.** Free-tier terms change. Check each provider's current limits and whether it asks for a card, and record what you checked (with the date) at the bottom of this file. The numbers below are the constraints the app was designed around, not guarantees.

## Constraints the design accounts for

- **Render free instances sleep when idle** and take up to about a minute to wake. The web app shows a "waking up the server" state and refreshes by itself. There's no separate worker service on the free plan, so the API runs the indexing worker in-process (ADR 0003).
- **Memory is 512 MB.** Measured locally: API ~110 MB, worker peak ~250 MB while indexing. `NODE_OPTIONS=--max-old-space-size=384` caps the V8 heap. Indexing runs one repository at a time.
- **Neon's free storage is small** (roughly 0.5 GB). 768-dimension vectors (~3 KB each), the 2,000-source-file limit and `MAX_CHUNKS=8000` keep one repository to tens of MB.
- **Upstash free Redis limits commands.** The worker waits 30 s between empty polls and checks for stalled jobs every 2 minutes (ADR 0003). An idle worker still issues a few thousand commands a day, so check the current monthly allowance.
- **Gemini's free tier has per-minute and per-day request limits.** Embedding batches back off on 429s. Chat is limited per user (`CHAT_DAILY_LIMIT`) and per anonymous IP (`DEMO_CHAT_DAILY_LIMIT`). On the free tier Google may use submitted content to improve its products (ADR 0004).

## 1. Database: Neon

1. Create a project. Choose a region close to where the Render service will run (the Blueprint uses Render's default, Oregon, so pick an AWS us-west region).
2. Copy the **direct** (non-pooled) connection string. It looks like `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`. Prisma migrations take advisory locks, which the pooled endpoint doesn't support well, and one API instance doesn't need pooling.
3. Nothing else to do: the API applies migrations when it boots, and the first migration enables `pgvector`.

## 2. Redis: Upstash

1. Create a Redis database (TLS on, which is the default).
2. Copy the `rediss://default:…@….upstash.io:6379` URL. The `rediss://` scheme (TLS) is accepted by the API's config validation.

## 3. AI: Google AI Studio

1. At https://aistudio.google.com, choose **Get API key → Create API key**. No billing setup is needed for the free tier.
2. Optional: to check which chat models your key can use:
   `curl -s -H "x-goog-api-key: $KEY" "https://generativelanguage.googleapis.com/v1beta/models" | grep '"name"'`.
   The default `LLM_MODEL=gemini-flash-latest` follows Google's current Flash model, and `LLM_FALLBACK_MODELS=gemini-flash-lite-latest` answers when it's overloaded.
3. Check that the key can actually call models (listing models isn't enough, see Troubleshooting):
   `curl -s -X POST -H "x-goog-api-key: $KEY" -H 'content-type: application/json' "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents" -d '{"requests":[{"model":"models/gemini-embedding-2","content":{"parts":[{"text":"hi"}]},"output_dimensionality":768}]}' | head -c 200`

## 4. API: Render

1. **New → Blueprint** and connect the GitHub repository. Render reads `render.yaml`.
2. Fill in the variables it asks for:
   - `DATABASE_URL`: from Neon
   - `REDIS_URL`: from Upstash
   - `WEB_ORIGIN`: the Vercel URL from step 5 (update it after the first Vercel deploy)
   - `GEMINI_API_KEY`: from AI Studio
   - `GITHUB_TOKEN`: a fine-grained token with _Public repositories (read-only)_ access. Without it GitHub allows only 60 requests/hour, shared by everyone using the demo.
   - `DEMO_REPOSITORIES`: e.g. `gothinkster/node-express-realworld-example-app,honojs/examples`. Pick small repositories so they index quickly on a free instance.
3. Deploy. The container runs `prisma migrate deploy`, starts the API, and begins indexing the demo repositories in the background.
4. Check `https://<service>.onrender.com/api/health`. All three dependencies should report `ok`.

## 5. Web app: Vercel

1. **Add New → Project** and import the repository.
2. Set **Root Directory** to `apps/web`. Vercel detects the npm workspace and installs from the repository root, so `@codebase-copilot/shared` resolves.
3. Add the environment variable `API_URL=https://<service>.onrender.com`. It's read at **build** time for the `/api/*` rewrites and at request time by server components, so redeploy after changing it.
4. Deploy, then set Render's `WEB_ORIGIN` to the Vercel URL.

## 6. Smoke test

1. Open the Vercel URL. The first request may show "Waking up the server…" while Render starts.
2. The demo repositories appear on the landing page once indexed. Open one, check the **Code** tab, and ask a question in **Chat**. Answers should stream and their `[n]` citations should open the right lines.
3. Sign up, add a small public repository, and watch it index.

## Troubleshooting

- **Health shows `redis: "Stream isn't writeable…"`**: `REDIS_URL` must start with `rediss://` (TLS). Upstash's connect page also shows `redis://` URLs meant for `redis-cli --tls`. The API now refuses to start with an Upstash URL that isn't `rediss://`.
- **`403 PERMISSION_DENIED: "Your project has been denied access"`** on every model call: the AI Studio _project_ is blocked. Create a key in a **new project** (Get API key → Create API key in new project). If that fails too, try a different personal Google account.
- **Chat says the models are overloaded:** free-tier Gemini models are busy at times. The API already falls back to `LLM_FALLBACK_MODELS`; add more comma-separated models from the list your key can see, or wait a minute.
- **Embedding takes minutes for a repository:** per-minute free-tier limits. The indexer backs off and continues on its own; the progress bar keeps moving.
- **The site shows "Waking up the server…" for more than two minutes:** check Render's logs. The API applies migrations on boot and fails fast on invalid configuration, listing which variables are wrong.

## Operating notes

- **Changing `DEMO_REPOSITORIES`** takes effect at the next API start. A demo repository stays pinned to the commit it was first indexed at.
- **Logs:** Render shows the API's structured JSON logs. Indexing logs `archive extracted` and `snapshot indexed` with counts and durations, and chat logs `chat answered` with latency.
- **Schema changes** deploy with the API. CI runs `db:check-drift`, which also protects the hand-written pgvector HNSW index (ADR 0004).

## Free-tier terms checked

| Provider         | Checked on | Notes                                                                                                                       |
| ---------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| Vercel           | 2026-09-29 | Signed up and deployed on the free plan; no credit card was requested                                                       |
| Render           | 2026-09-29 | Signed up and deployed on the free plan; no credit card was requested                                                       |
| Neon             | 2026-09-29 | Signed up and deployed on the free plan; no credit card was requested                                                       |
| Upstash          | 2026-09-29 | Signed up and deployed on the free plan; no credit card was requested                                                       |
| Google AI Studio | 2026-09-29 | Free tier without billing or a card (billing docs); free-tier content may be used to improve Google products (pricing page) |

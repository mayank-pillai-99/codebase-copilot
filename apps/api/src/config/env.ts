import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  APP_VERSION: z.string().default('0.0.0'),
  // Generate with: openssl rand -base64 48
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // Set to true only when the API sits behind a proxy that sets X-Forwarded-For (Render, Next.js rewrites).
  TRUST_PROXY: z.stringbool().default(false),

  // Server-side only; raises GitHub's rate limit from 60 to 5,000 requests/hour. Empty = none.
  GITHUB_TOKEN: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  // Free hosting has no separate worker service, so the API can run the indexing worker itself.
  RUN_WORKER_IN_PROCESS: z.stringbool().default(false),
  // Indexing limits (SPEC §5.1); the total bounds memory, since files are held in memory.
  MAX_ARCHIVE_MB: z.coerce.number().positive().default(50),
  MAX_SOURCE_FILES: z.coerce.number().int().positive().default(2_000),
  MAX_FILE_KB: z.coerce.number().positive().default(200),
  MAX_TOTAL_SOURCE_MB: z.coerce.number().positive().default(30),
  // Chunks are what gets embedded and stored with vectors (~3 KB each plus index).
  MAX_CHUNKS: z.coerce.number().int().positive().default(8_000),

  // Google AI Studio key for embeddings and chat (ADR 0004). Empty = AI features off:
  // indexing still works, search falls back to full-text only.
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  // Changing the embedding model requires re-indexing (the vector column is 768-dimension).
  EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
  // Chat model; the -latest alias follows Google's current Flash model.
  LLM_MODEL: z.string().default('gemini-flash-latest'),
  // Answers per user per day, protecting the free LLM quota.
  CHAT_DAILY_LIMIT: z.coerce.number().int().positive().default(100),

  // Public demo: comma-separated owner/name repositories anyone can explore without an
  // account. They're indexed automatically at startup. Empty = no demo.
  DEMO_REPOSITORIES: z.string().default(''),
  // Anonymous demo answers per IP per day.
  DEMO_CHAT_DAILY_LIMIT: z.coerce.number().int().positive().default(20),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Validates configuration once at startup so misconfiguration fails fast with a readable message. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

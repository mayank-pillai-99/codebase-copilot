import { Embeddings } from '@langchain/core/embeddings';

/** Fixed by the chunks.embedding column type (ADR 0004). */
export const EMBEDDING_DIMENSIONS = 768;

const API = 'https://generativelanguage.googleapis.com/v1beta';
// Stay well under the model's 8,192-token input limit (code averages 3–4 chars/token).
const MAX_INPUT_CHARS = 20_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export interface GeminiEmbeddingsOptions {
  apiKey: string;
  model?: string;
  batchSize?: number;
  /** Attempts per batch for rate limits and server errors. */
  maxAttempts?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Gemini embeddings as a LangChain `Embeddings`. LangChain's own Gemini class can't
 * request a reduced output dimension, so this calls `batchEmbedContents` directly.
 *
 * gemini-embedding-2 takes task instructions inside the text: queries are prefixed
 * for code retrieval and documents carry a title (see formatDocument).
 */
export class GeminiEmbeddings extends Embeddings {
  readonly model: string;
  private readonly apiKey: string;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: GeminiEmbeddingsOptions) {
    super({});
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'gemini-embedding-2';
    this.batchSize = options.batchSize ?? 100;
    this.maxAttempts = options.maxAttempts ?? 6;
    this.doFetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  static formatDocument(title: string, text: string): string {
    return `title: ${title || 'none'} | text: ${text}`;
  }

  static formatQuery(query: string): string {
    return `task: code retrieval | query: ${query}`;
  }

  /** Embeds already-formatted documents, in batches, reporting progress after each batch. */
  async embedDocuments(
    documents: string[],
    onProgress?: (done: number, total: number) => void | Promise<void>,
  ): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < documents.length; i += this.batchSize) {
      vectors.push(...(await this.embedBatch(documents.slice(i, i + this.batchSize))));
      await onProgress?.(vectors.length, documents.length);
    }
    return vectors;
  }

  async embedQuery(query: string): Promise<number[]> {
    const [vector] = await this.embedBatch([GeminiEmbeddings.formatQuery(query)]);
    return vector!;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const body = JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${this.model}`,
        content: { parts: [{ text: text.slice(0, MAX_INPUT_CHARS) }] },
        output_dimensionality: EMBEDDING_DIMENSIONS,
      })),
    });

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.doFetch(`${API}/models/${this.model}:batchEmbedContents`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
          body,
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        if (attempt >= this.maxAttempts) {
          throw new EmbeddingError('Could not reach the embedding service.', true);
        }
        await this.sleep(backoff(attempt));
        continue;
      }

      if (res.ok) return parseVectors(await res.json(), texts.length);

      const detail = await res.json().catch(() => null);
      if (RETRYABLE.has(res.status) && attempt < this.maxAttempts) {
        await this.sleep(retryDelay(res, detail) ?? backoff(attempt));
        continue;
      }
      throw new EmbeddingError(
        `Embedding request failed (${res.status}): ${errorMessage(detail)}`,
        RETRYABLE.has(res.status),
      );
    }
  }
}

function parseVectors(body: unknown, expected: number): number[][] {
  const embeddings = (body as { embeddings?: { values?: unknown }[] })?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== expected) {
    throw new EmbeddingError('Embedding service returned an unexpected number of vectors.', false);
  }
  return embeddings.map(({ values }) => {
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingError(
        `Expected ${EMBEDDING_DIMENSIONS}-dimension vectors from the embedding service.`,
        false,
      );
    }
    return values as number[];
  });
}

/** Exponential backoff with jitter: ~2 s, 4 s, 8 s … capped at 60 s. */
function backoff(attempt: number): number {
  const base = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
  return base / 2 + Math.random() * (base / 2);
}

/** Honors Retry-After, or Google's RetryInfo detail ("retryDelay": "23s"). */
function retryDelay(res: Response, detail: unknown): number | null {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header, 120) * 1_000;
  const details = (detail as { error?: { details?: { retryDelay?: string }[] } })?.error?.details;
  const delay = details?.find((d) => typeof d.retryDelay === 'string')?.retryDelay;
  const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
  return Number.isFinite(seconds) ? Math.min(seconds, 120) * 1_000 : null;
}

function errorMessage(detail: unknown): string {
  const message = (detail as { error?: { message?: string } })?.error?.message;
  return typeof message === 'string' ? message.slice(0, 300) : 'unknown error';
}

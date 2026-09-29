import { describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS, EmbeddingError, GeminiEmbeddings } from '../src/llm/embeddings';

const vector = (seed: number) =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => seed + i / 1e4);

/** Answers batchEmbedContents with one vector per request, or the given responses in order. */
function fakeGemini(responses?: (Response | Error)[]) {
  const queue = responses ? [...responses] : null;
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (queue) {
      const next = queue.shift()!;
      if (next instanceof Error) throw next;
      return next;
    }
    const { requests } = JSON.parse(String(init?.body)) as { requests: unknown[] };
    return Response.json({ embeddings: requests.map((_, i) => ({ values: vector(i) })) });
  });
}

const noSleep = async () => undefined;

describe('GeminiEmbeddings', () => {
  it('requests 768-dimension vectors from batchEmbedContents with the API key header', async () => {
    const fetch = fakeGemini();
    const embeddings = new GeminiEmbeddings({ apiKey: 'test-key', fetch, sleep: noSleep });

    const [first] = await embeddings.embedDocuments(['title: a.ts | text: code']);
    expect(first).toHaveLength(768);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents',
    );
    expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
    expect(JSON.parse(String(init?.body))).toEqual({
      requests: [
        {
          model: 'models/gemini-embedding-2',
          content: { parts: [{ text: 'title: a.ts | text: code' }] },
          output_dimensionality: 768,
        },
      ],
    });
  });

  it('batches documents and reports progress after each batch', async () => {
    const fetch = fakeGemini();
    const progress: string[] = [];
    const embeddings = new GeminiEmbeddings({ apiKey: 'k', fetch, batchSize: 100, sleep: noSleep });

    const vectors = await embeddings.embedDocuments(
      Array.from({ length: 250 }, (_, i) => `doc ${i}`),
      (done, total) => void progress.push(`${done}/${total}`),
    );
    expect(vectors).toHaveLength(250);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(progress).toEqual(['100/250', '200/250', '250/250']);
  });

  it('formats queries and documents with the instructions gemini-embedding-2 expects', async () => {
    const fetch = fakeGemini();
    await new GeminiEmbeddings({ apiKey: 'k', fetch, sleep: noSleep }).embedQuery('where is auth?');
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body.requests[0].content.parts[0].text).toBe(
      'task: code retrieval | query: where is auth?',
    );
    expect(GeminiEmbeddings.formatDocument('src/a.ts · login', 'code')).toBe(
      'title: src/a.ts · login | text: code',
    );
    expect(GeminiEmbeddings.formatDocument('', 'x')).toBe('title: none | text: x');
  });

  it('truncates very long inputs', async () => {
    const fetch = fakeGemini();
    await new GeminiEmbeddings({ apiKey: 'k', fetch, sleep: noSleep }).embedDocuments([
      'x'.repeat(50_000),
    ]);
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body.requests[0].content.parts[0].text).toHaveLength(20_000);
  });

  it('waits and retries on rate limits, honoring Google retryDelay', async () => {
    const sleep = vi.fn(noSleep);
    const rateLimited = Response.json(
      { error: { message: 'quota', details: [{ retryDelay: '23s' }] } },
      { status: 429 },
    );
    const fetch = fakeGemini([rateLimited, Response.json({ embeddings: [{ values: vector(1) }] })]);

    await new GeminiEmbeddings({ apiKey: 'k', fetch, sleep }).embedDocuments(['a']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(23_000);
  });

  it('honors Retry-After and retries network errors', async () => {
    const sleep = vi.fn(noSleep);
    const fetch = fakeGemini([
      new TypeError('fetch failed'),
      new Response('', { status: 503, headers: { 'retry-after': '5' } }),
      Response.json({ embeddings: [{ values: vector(1) }] }),
    ]);

    await new GeminiEmbeddings({ apiKey: 'k', fetch, sleep }).embedDocuments(['a']);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenLastCalledWith(5_000);
  });

  it('gives up after the last attempt with a retryable error', async () => {
    const fetch = fakeGemini(Array.from({ length: 3 }, () => new Response('', { status: 429 })));
    const embeddings = new GeminiEmbeddings({ apiKey: 'k', fetch, maxAttempts: 3, sleep: noSleep });

    const error = await embeddings.embedDocuments(['a']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect(error).toMatchObject({ retryable: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry invalid requests and surfaces the API message', async () => {
    const fetch = fakeGemini([
      Response.json({ error: { message: 'API key not valid.' } }, { status: 400 }),
    ]);
    const error = await new GeminiEmbeddings({ apiKey: 'bad', fetch, sleep: noSleep })
      .embedDocuments(['a'])
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      retryable: false,
      message: 'Embedding request failed (400): API key not valid.',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects vectors with the wrong dimension', async () => {
    const fetch = fakeGemini([Response.json({ embeddings: [{ values: [1, 2, 3] }] })]);
    await expect(
      new GeminiEmbeddings({ apiKey: 'k', fetch, sleep: noSleep }).embedDocuments(['a']),
    ).rejects.toThrow(/768-dimension/);
  });
});

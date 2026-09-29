import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { GeminiChat } from './gemini-chat';
import type { PromptMessage } from '../chat/prompt';

/** The narrow interface chat needs from an LLM, so providers (and test fakes) can swap. */
export interface ChatModel {
  readonly model: string;
  /** Streams answer text. Rejects on provider errors; stops early when `signal` aborts. */
  stream(messages: PromptMessage[], signal?: AbortSignal): AsyncIterable<string>;
}

export type ChatFailure = 'overloaded' | 'rate-limited' | 'rejected' | 'failed';

export class ChatModelError extends Error {
  constructor(
    message: string,
    public readonly kind: ChatFailure = 'failed',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ChatModelError';
  }

  /** Worth trying another model: this one is busy, not broken. */
  get transient(): boolean {
    return this.kind === 'overloaded' || this.kind === 'rate-limited';
  }
}

const MESSAGES: Record<ChatFailure, string> = {
  overloaded: 'The AI models are overloaded right now. Please try again in a minute.',
  'rate-limited': 'The AI service is rate-limiting requests. Please try again in a minute.',
  rejected: 'The AI service rejected the request. Check the API key.',
  failed: 'The AI service failed to answer. Please try again.',
};

// Free-tier models sometimes stall instead of answering 503; give the next model a turn.
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 15_000;

/**
 * Gemini through our LangChain chat model (see gemini-chat.ts for why it isn't
 * LangChain's own Gemini integration). Retries are off: an overloaded model should
 * hand over to a fallback within seconds rather than retry for a minute.
 */
export function createGeminiChatModel(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): ChatModel {
  const llm = new GeminiChat({
    apiKey: options.apiKey,
    model: options.model,
    maxRetries: 0,
    ...(options.fetch && { fetch: options.fetch }),
  });

  return {
    model: options.model,
    async *stream(messages, signal) {
      let stream;
      try {
        stream = await llm.stream(messages.map(toLangChain), { signal });
      } catch (err) {
        if (signal?.aborted) return;
        throw classify(err);
      }
      try {
        for await (const chunk of stream) {
          const text = typeof chunk.content === 'string' ? chunk.content : chunk.text;
          if (text) yield text;
        }
      } catch (err) {
        if (signal?.aborted) return;
        throw classify(err);
      }
    },
  };
}

/**
 * Tries models in order. When one is overloaded or rate-limited before producing any
 * text, the next one answers instead. Free-tier models are busy often enough that
 * this matters. Failures after text has streamed are passed on, since switching
 * models mid-answer would produce a garbled reply.
 */
export function withFallbacks(
  models: ChatModel[],
  options: { firstTokenTimeoutMs?: number } = {},
): ChatModel {
  if (models.length === 0) throw new Error('withFallbacks needs at least one model');
  const firstTokenTimeoutMs = options.firstTokenTimeoutMs ?? DEFAULT_FIRST_TOKEN_TIMEOUT_MS;

  return {
    model: models.map((m) => m.model).join(' → '),
    async *stream(messages, signal) {
      for (const [i, model] of models.entries()) {
        const last = i === models.length - 1;
        // Per-attempt signal: aborted when the caller aborts, or when this model is too slow.
        const attempt = new AbortController();
        const onAbort = () => attempt.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        const iterator = model.stream(messages, attempt.signal)[Symbol.asyncIterator]();
        let started = false;
        try {
          // The last model gets no deadline: slow is better than nothing.
          const first = await (last
            ? iterator.next()
            : firstOrTimeout(iterator, firstTokenTimeoutMs, attempt));
          if (first.done) return;
          started = true;
          yield first.value;
          for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
            yield next.value;
          }
          return;
        } catch (err) {
          if (signal?.aborted) return;
          if (started || last || !(err instanceof ChatModelError) || !err.transient) throw err;
        } finally {
          signal?.removeEventListener('abort', onAbort);
        }
      }
    },
  };
}

async function firstOrTimeout(
  iterator: AsyncIterator<string>,
  timeoutMs: number,
  attempt: AbortController,
): Promise<IteratorResult<string>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          attempt.abort();
          reject(new ChatModelError(MESSAGES.overloaded, 'overloaded'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function toLangChain(message: PromptMessage): BaseMessage {
  if (message.role === 'system') return new SystemMessage(message.content);
  if (message.role === 'assistant') return new AIMessage(message.content);
  return new HumanMessage(message.content);
}

export function classify(err: unknown): ChatModelError {
  const text = err instanceof Error ? err.message : String(err);
  const kind: ChatFailure = /\b503\b|overloaded|high demand|unavailable/i.test(text)
    ? 'overloaded'
    : /\b429\b|quota|rate.?limit|resource.?exhausted/i.test(text)
      ? 'rate-limited'
      : /API key|permission|denied|\b40[13]\b/i.test(text)
        ? 'rejected'
        : 'failed';
  return new ChatModelError(MESSAGES[kind], kind, { cause: err });
}

import { describe, expect, it, vi } from 'vitest';
import { ChatModelError, classify, withFallbacks, type ChatModel } from '../src/llm/chat-model';

function model(
  name: string,
  behavior: string[] | ChatModelError,
  failAfter?: ChatModelError,
): ChatModel {
  return {
    model: name,
    stream: vi.fn(async function* () {
      if (behavior instanceof ChatModelError) throw behavior;
      for (const token of behavior) yield token;
      if (failAfter) throw failAfter;
    }),
  };
}

async function collect(chat: ChatModel) {
  let text = '';
  for await (const token of chat.stream([{ role: 'user', content: 'hi' }])) text += token;
  return text;
}

const overloaded = new ChatModelError('busy', 'overloaded');

describe('withFallbacks', () => {
  it('uses the first model when it answers', async () => {
    const fallback = model('b', ['unused']);
    expect(await collect(withFallbacks([model('a', ['Hello ', 'world']), fallback]))).toBe(
      'Hello world',
    );
    expect(fallback.stream).not.toHaveBeenCalled();
  });

  it('moves to the next model when one is overloaded or rate-limited before answering', async () => {
    const chat = withFallbacks([
      model('a', overloaded),
      model('b', new ChatModelError('quota', 'rate-limited')),
      model('c', ['From c']),
    ]);
    expect(await collect(chat)).toBe('From c');
    expect(chat.model).toBe('a → b → c');
  });

  it('does not hide configuration problems behind a fallback', async () => {
    const rejected = new ChatModelError('bad key', 'rejected');
    const fallback = model('b', ['unused']);
    await expect(collect(withFallbacks([model('a', rejected), fallback]))).rejects.toBe(rejected);
    expect(fallback.stream).not.toHaveBeenCalled();
  });

  it('does not switch models once text has streamed', async () => {
    const fallback = model('b', ['unused']);
    const chat = withFallbacks([model('a', ['partial '], overloaded), fallback]);
    await expect(collect(chat)).rejects.toBe(overloaded);
    expect(fallback.stream).not.toHaveBeenCalled();
  });

  it('reports the last error when every model is busy', async () => {
    const last = new ChatModelError('still busy', 'overloaded');
    await expect(collect(withFallbacks([model('a', overloaded), model('b', last)]))).rejects.toBe(
      last,
    );
  });
});

describe('withFallbacks first-token deadline', () => {
  const stalled = (name: string): ChatModel & { aborted: () => boolean } => {
    let signalSeen: AbortSignal | undefined;
    return {
      model: name,
      aborted: () => signalSeen?.aborted ?? false,
      async *stream(_messages, signal) {
        signalSeen = signal;
        // Never answers until aborted, then ends without output.
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
        yield* [];
      },
    };
  };

  it('abandons a model that stalls before its first token and aborts its request', async () => {
    const slow = stalled('a');
    const chat = withFallbacks([slow, model('b', ['From b'])], { firstTokenTimeoutMs: 30 });
    expect(await collect(chat)).toBe('From b');
    expect(slow.aborted()).toBe(true);
  });

  it('gives the last model no deadline', async () => {
    const lateAnswer: ChatModel = {
      model: 'b',
      async *stream() {
        await new Promise((resolve) => setTimeout(resolve, 60));
        yield 'late but fine';
      },
    };
    const chat = withFallbacks([model('a', overloaded), lateAnswer], { firstTokenTimeoutMs: 20 });
    expect(await collect(chat)).toBe('late but fine');
  });

  it('stops quietly when the caller aborts', async () => {
    const abort = new AbortController();
    const chat = withFallbacks([stalled('a'), stalled('b')], { firstTokenTimeoutMs: 10_000 });
    setTimeout(() => abort.abort(), 20);
    const tokens: string[] = [];
    for await (const token of chat.stream([{ role: 'user', content: 'hi' }], abort.signal))
      tokens.push(token);
    expect(tokens).toEqual([]);
  });

  it('keeps the provider error as the cause', () => {
    const original = new Error('[503 Service Unavailable] high demand');
    expect(classify(original).cause).toBe(original);
  });
});

describe('classify', () => {
  it.each([
    ['[503 Service Unavailable] This model is currently experiencing high demand.', 'overloaded'],
    ['[429 Too Many Requests] Resource has been exhausted (e.g. check quota).', 'rate-limited'],
    ['[403 Forbidden] Your project has been denied access.', 'rejected'],
    ['[400 Bad Request] API key not valid.', 'rejected'],
    ['socket hang up', 'failed'],
  ])('%s → %s', (message, kind) => {
    const error = classify(new Error(message));
    expect(error.kind).toBe(kind);
    expect(error.message).not.toContain('['); // user-facing text, not the provider's
  });
});

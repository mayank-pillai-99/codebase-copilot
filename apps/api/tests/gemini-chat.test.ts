import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { createGeminiChatModel } from '../src/llm/chat-model';
import { GeminiChat, parseEvent, readServerSentEvents } from '../src/llm/gemini-chat';

/** A text/event-stream body delivered in arbitrary byte slices, like a real network. */
function sseBody(events: unknown[], sliceSize = 7): ReadableStream<Uint8Array> {
  const text = events
    .map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\r\n\r\n`)
    .join('');
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + sliceSize));
      offset += sliceSize;
    },
  });
}

const textEvent = (text: string, thought = false) => ({
  candidates: [{ content: { parts: [{ text, ...(thought && { thought: true }) }] } }],
});

function fakeFetch(response: Response) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response);
}

async function collect(stream: AsyncIterable<string>) {
  let text = '';
  for await (const token of stream) text += token;
  return text;
}

describe('GeminiChat (LangChain chat model over REST)', () => {
  it('streams text from server-sent events split across network chunks', async () => {
    const fetch = fakeFetch(
      new Response(
        sseBody([
          textEvent('Login is ', false),
          textEvent('planning the answer', true), // thought parts are not answer text
          textEvent('in auth.ts [1].'),
          { candidates: [{ finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 9 } },
        ]),
      ),
    );
    const chat = createGeminiChatModel({ apiKey: 'k', model: 'gemini-flash-latest', fetch });
    expect(await collect(chat.stream([{ role: 'user', content: 'Where is login?' }]))).toBe(
      'Login is in auth.ts [1].',
    );
  });

  it('sends system instructions and alternating user/model turns', async () => {
    const fetch = fakeFetch(new Response(sseBody([textEvent('ok')])));
    const model = new GeminiChat({ apiKey: 'secret', model: 'm', fetch });
    await model.invoke([
      new SystemMessage('rules'),
      new HumanMessage('q1'),
      new AIMessage('a1'),
      new HumanMessage('q2'),
    ]);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?alt=sse',
    );
    expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'secret' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      systemInstruction: { parts: [{ text: 'rules' }] },
      contents: [
        { role: 'user', parts: [{ text: 'q1' }] },
        { role: 'model', parts: [{ text: 'a1' }] },
        { role: 'user', parts: [{ text: 'q2' }] },
      ],
    });
  });

  it.each([
    [503, 'This model is currently experiencing high demand.', 'overloaded'],
    [429, 'Resource has been exhausted.', 'rate-limited'],
    [403, 'Your project has been denied access.', 'rejected'],
  ])('maps HTTP %i to a %s error', async (status, message, kind) => {
    const fetch = fakeFetch(Response.json({ error: { code: status, message } }, { status }));
    const chat = createGeminiChatModel({ apiKey: 'k', model: 'm', fetch });
    await expect(collect(chat.stream([{ role: 'user', content: 'hi' }]))).rejects.toMatchObject({
      kind,
    });
  });

  it('turns an error event mid-stream into a failure without an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const fetch = fakeFetch(
        new Response(
          sseBody([textEvent('partial '), { error: { code: 503, message: 'overloaded' } }]),
        ),
      );
      const chat = createGeminiChatModel({ apiKey: 'k', model: 'm', fetch });
      await expect(collect(chat.stream([{ role: 'user', content: 'hi' }]))).rejects.toMatchObject({
        kind: 'overloaded',
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('stream parsing', () => {
  it('reads data payloads with \\n or \\r\\n separators and a final unterminated event', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"a":1}\n\ndata: {"b":'));
        controller.enqueue(encoder.encode('2}\r\n\r\n: comment\n\ndata: {"c":3}'));
        controller.close();
      },
    });
    const events: string[] = [];
    for await (const e of readServerSentEvents(body)) events.push(e);
    expect(events).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('reports blocked prompts and unreadable events as errors', () => {
    expect(parseEvent('{"promptFeedback":{"blockReason":"SAFETY"}}').error?.message).toBe(
      'Request blocked: SAFETY',
    );
    expect(parseEvent('not json').error?.code).toBe(502);
    expect(parseEvent('{"usageMetadata":{}}')).toEqual({ text: '' });
  });
});

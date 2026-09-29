import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatService } from '../src/chat/chat.service';
import { AppError } from '../src/lib/errors';
import { buildTestApp, signIn, unusedChat } from './support/app';

const SNAPSHOT = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const SESSION = '1f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

function parseSse(body: string) {
  return body
    .trim()
    .split('\n\n')
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');
      return {
        event: eventLine?.replace('event: ', ''),
        data: JSON.parse(dataLine!.replace('data: ', '')),
      };
    });
}

describe('POST /api/snapshots/:id/chat', () => {
  it('streams events as Server-Sent Events', async () => {
    const chat: ChatService = {
      ...unusedChat,
      prepare: vi.fn(async ({ message }) => ({
        sessionId: SESSION,
        snapshotId: SNAPSHOT,
        question: message,
        history: [],
      })),
      answer: async (_prepared, emit) => {
        emit({ type: 'session', sessionId: SESSION });
        emit({ type: 'token', text: 'Hello' });
        emit({ type: 'done', messageId: SESSION, content: 'Hello', citations: [], flagged: false });
      },
    };
    app = await buildTestApp({ chat });
    const { userId, cookies } = await signIn(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/snapshots/${SNAPSHOT}/chat`,
      cookies,
      payload: { message: '  How does auth work?  ' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(parseSse(res.body).map((e) => e.event)).toEqual(['session', 'token', 'done']);
    expect(chat.prepare).toHaveBeenCalledWith({
      userId,
      snapshotId: SNAPSHOT,
      sessionId: undefined,
      message: 'How does auth work?',
    });
  });

  it('returns ordinary JSON errors for problems found before streaming', async () => {
    app = await buildTestApp({
      chat: {
        ...unusedChat,
        prepare: async () => {
          throw new AppError(
            409,
            'This repository is still being indexed. Try again when it is ready.',
          );
        },
      },
    });
    const { cookies } = await signIn(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/snapshots/${SNAPSHOT}/chat`,
      cookies,
      payload: { message: 'hi' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/still being indexed/);
  });

  it('validates the question and requires a session', async () => {
    app = await buildTestApp();
    const anonymous = await app.inject({
      method: 'POST',
      url: `/api/snapshots/${SNAPSHOT}/chat`,
      payload: { message: 'hi' },
    });
    expect(anonymous.statusCode).toBe(401);

    const { cookies } = await signIn(app);
    const empty = await app.inject({
      method: 'POST',
      url: `/api/snapshots/${SNAPSHOT}/chat`,
      cookies,
      payload: { message: '   ' },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().issues[0].message).toBe('Ask a question about the code');
  });

  it('enforces the daily quota per user', async () => {
    const consume = vi.fn(async () => false);
    app = await buildTestApp({ chatQuota: { consume } });
    const { userId, cookies } = await signIn(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/snapshots/${SNAPSHOT}/chat`,
      cookies,
      payload: { message: 'hi' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatch(/today's question limit/);
    expect(consume).toHaveBeenCalledWith(userId);
  });
});

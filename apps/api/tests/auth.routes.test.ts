import { authResponseSchema } from '@codebase-copilot/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/plugins/auth';
import { buildTestApp, testEnv } from './support/app';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

const credentials = { email: 'ada@example.com', password: 'correct horse' };

function sessionCookie(res: LightMyRequestResponse) {
  return res.cookies.find((c) => c.name === SESSION_COOKIE);
}

async function register(body: object = credentials) {
  return app.inject({ method: 'POST', url: '/api/auth/register', payload: body });
}

describe('POST /api/auth/register', () => {
  it('creates the account and starts a session in an httpOnly, SameSite=Lax cookie', async () => {
    app = await buildTestApp();
    const res = await register({ email: ' Ada@Example.com ', password: 'correct horse' });

    expect(res.statusCode).toBe(201);
    expect(authResponseSchema.parse(res.json()).user.email).toBe('ada@example.com');
    const cookie = sessionCookie(res);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.maxAge).toBe(7 * 24 * 60 * 60);
    // Secure is only set in production (local development runs over HTTP).
    expect(cookie?.secure).toBeFalsy();
  });

  it('returns 409 for an email that is already registered', async () => {
    app = await buildTestApp();
    await register();
    const res = await register();

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'An account with this email already exists' });
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('returns field-level validation errors without echoing the input', async () => {
    app = await buildTestApp();
    const res = await register({ email: 'not-an-email', password: 'short' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'Invalid request',
      issues: [
        { path: ['email'], message: 'Enter a valid email address' },
        { path: ['password'], message: 'Password must be at least 8 characters' },
      ],
    });
  });

  it('rejects non-JSON bodies', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify(credentials),
    });

    expect(res.statusCode).toBe(415);
  });
});

describe('POST /api/auth/login', () => {
  it('starts a session with valid credentials', async () => {
    app = await buildTestApp();
    await register();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ADA@example.com', password: 'correct horse' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('ada@example.com');
    expect(sessionCookie(res)?.value).toBeTruthy();
  });

  it('returns a generic 401 for a wrong password or unknown email', async () => {
    app = await buildTestApp();
    await register();
    for (const payload of [
      { email: credentials.email, password: 'wrong password' },
      { email: 'grace@example.com', password: 'whatever' },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Invalid email or password' });
      expect(sessionCookie(res)).toBeUndefined();
    }
  });

  it('rate-limits repeated attempts from one IP', async () => {
    app = await buildTestApp();
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'x@example.com', password: 'guess' },
      });

    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    const limited = await attempt();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('GET /api/auth/me', () => {
  it('returns the signed-in user', async () => {
    app = await buildTestApp();
    const registered = await register();
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: sessionCookie(registered)!.value },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(registered.json());
  });

  it('returns 401 without a session', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Please sign in to continue' });
  });

  it('rejects a tampered token', async () => {
    app = await buildTestApp();
    const token = sessionCookie(await register())!.value;
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'someone-else' })).toString(
      'base64url',
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: `${header}.${forgedPayload}.${signature}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects a token signed with a different secret', async () => {
    const other = await buildTestApp({
      env: { ...testEnv, JWT_SECRET: 'x'.repeat(40) },
    });
    const foreignToken = await other.jwt.sign({ sub: 'user-id' });
    await other.close();

    app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: foreignToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it('clears the cookie when the account no longer exists', async () => {
    app = await buildTestApp();
    const token = await app.jwt.sign({ sub: '00000000-0000-4000-8000-000000000000' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: token },
    });

    expect(res.statusCode).toBe(401);
    expect(sessionCookie(res)?.value).toBe('');
  });
});

describe('POST /api/auth/logout', () => {
  it('expires the session cookie', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });

    expect(res.statusCode).toBe(204);
    const cookie = sessionCookie(res);
    expect(cookie?.value).toBe('');
    expect(cookie?.expires?.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

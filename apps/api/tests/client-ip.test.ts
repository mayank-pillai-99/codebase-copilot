import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClientIp } from '../src/lib/client-ip';
import { buildTestApp, testEnv } from './support/app';

const SECRET = 'proxy-secret-that-is-at-least-32-characters';

describe('resolveClientIp', () => {
  const request = (headers: Record<string, string>) => ({ ip: '10.0.0.1', headers });

  it('uses the forwarded IP only with the right proxy secret', () => {
    const signed = { 'x-client-ip': '203.0.113.7', 'x-proxy-secret': SECRET };
    expect(resolveClientIp(request(signed), SECRET)).toBe('203.0.113.7');
    expect(resolveClientIp(request({ ...signed, 'x-proxy-secret': 'wrong' }), SECRET)).toBe(
      '10.0.0.1',
    );
    expect(resolveClientIp(request({ 'x-client-ip': '203.0.113.7' }), SECRET)).toBe('10.0.0.1');
  });

  it('ignores forwarded IPs when no secret is configured, and rejects non-IPs', () => {
    const signed = { 'x-client-ip': '203.0.113.7', 'x-proxy-secret': SECRET };
    expect(resolveClientIp(request(signed), undefined)).toBe('10.0.0.1');
    expect(resolveClientIp(request({ ...signed, 'x-client-ip': 'not-an-ip' }), SECRET)).toBe(
      '10.0.0.1',
    );
  });
});

describe('rate limits by client IP', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  const attempt = (headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { email: 'x@example.com', password: 'guess' },
    });

  it("can't be bypassed by sending a different IP header without the secret", async () => {
    app = await buildTestApp({ env: { ...testEnv, PROXY_SECRET: SECRET } });
    for (let i = 0; i < 10; i++) {
      expect((await attempt({ 'x-client-ip': `203.0.113.${i}` })).statusCode).toBe(401);
    }
    expect((await attempt({ 'x-client-ip': '203.0.113.99' })).statusCode).toBe(429);
  });

  it('counts visitors forwarded by the web server separately', async () => {
    app = await buildTestApp({ env: { ...testEnv, PROXY_SECRET: SECRET } });
    const from = (ip: string) => ({ 'x-client-ip': ip, 'x-proxy-secret': SECRET });
    for (let i = 0; i < 10; i++) expect((await attempt(from('203.0.113.1'))).statusCode).toBe(401);
    expect((await attempt(from('203.0.113.1'))).statusCode).toBe(429);
    expect((await attempt(from('203.0.113.2'))).statusCode).toBe(401);
  });
});

describe('TRUST_PROXY as a hop count', () => {
  it('uses the address added by the nearest proxy, not one the client sent', async () => {
    const app = await buildTestApp({ env: { ...testEnv, TRUST_PROXY: 1 } });
    app.get('/whoami', async (request) => ({ ip: request.clientIp }));
    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      remoteAddress: '10.0.0.1',
      // The client sent "1.1.1.1"; the platform proxy appended the real address.
      headers: { 'x-forwarded-for': '1.1.1.1, 198.51.100.4' },
    });
    expect(res.json()).toEqual({ ip: '198.51.100.4' });
    await app.close();
  });
});

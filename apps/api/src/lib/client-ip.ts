import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from '@codebase-copilot/shared';
import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** The visitor's IP for rate limits and quotas (see resolveClientIp). */
    clientIp: string;
  }
}

/**
 * The visitor's IP. Requests forwarded by our Next.js server carry it in a header,
 * trusted only with the shared proxy secret; anything else uses the connection's IP
 * as seen through the configured proxy hops, which a client can't spoof.
 */
export function resolveClientIp(
  request: Pick<FastifyRequest, 'headers' | 'ip'>,
  proxySecret: string | undefined,
): string {
  if (proxySecret) {
    const secret = request.headers[PROXY_SECRET_HEADER];
    const ip = request.headers[CLIENT_IP_HEADER];
    if (typeof secret === 'string' && typeof ip === 'string' && sameSecret(secret, proxySecret)) {
      const trimmed = ip.trim();
      if (isIP(trimmed)) return trimmed;
    }
  }
  return request.ip;
}

/** Constant-time comparison; hashing first makes the lengths equal. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

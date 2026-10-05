import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from '@codebase-copilot/shared';

/**
 * The visitor's IP as the hosting platform reports it. Vercel sets these headers
 * itself, replacing any a visitor sends.
 */
export function visitorIp(headers: Headers): string | null {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

/**
 * Headers telling the API which visitor a request is for, signed with the secret it
 * shares with the API, so per-visitor rate limits work through this server.
 * Without PROXY_SECRET, nothing is forwarded.
 */
export function forwardingHeaders(
  incoming: Headers,
  secret = process.env.PROXY_SECRET,
): Record<string, string> {
  const ip = visitorIp(incoming);
  return secret && ip ? { [CLIENT_IP_HEADER]: ip, [PROXY_SECRET_HEADER]: secret } : {};
}

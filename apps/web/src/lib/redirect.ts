const DEFAULT_AFTER_LOGIN = '/repos';

/**
 * Only same-site paths are allowed after login, so `?next=` can't be used to send
 * users to another site (an open redirect).
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/')) return DEFAULT_AFTER_LOGIN;
  // "//evil.com" and "/\evil.com" are treated by browsers as other origins.
  if (next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_AFTER_LOGIN;
  return next;
}

import 'server-only';
import { SESSION_COOKIE } from '@codebase-copilot/shared';
import { cookies } from 'next/headers';
import type { z } from 'zod';
import { API_URL } from './config';

export type ApiResult<T> =
  | { ok: true; data: T }
  /** unreachable: the API didn't answer at all (e.g. a free-tier host still waking up). */
  | { ok: false; status: number; error: string; unreachable?: boolean };

/**
 * Calls the API from a server component with the visitor's session cookie and
 * validates the response against the shared schema.
 */
export async function serverApi<T>(path: string, schema: z.ZodType<T>): Promise<ApiResult<T>> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const error =
        typeof body === 'object' && body && 'error' in body && typeof body.error === 'string'
          ? body.error
          : 'Something went wrong.';
      return { ok: false, status: res.status, error };
    }
    const parsed = schema.safeParse(body);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, status: 502, error: 'Unexpected response from the server.' };
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'The server is not reachable right now.',
      unreachable: true,
    };
  }
}

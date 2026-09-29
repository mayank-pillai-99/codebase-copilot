import 'server-only';
import { authResponseSchema, SESSION_COOKIE, type PublicUser } from '@codebase-copilot/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { API_URL } from './config';

/**
 * The signed-in user for this request, or null. The API is the only thing that can
 * verify the session token, so the cookie is forwarded to it; `cache` dedupes the
 * call when the layout and page both ask.
 */
export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const parsed = authResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.user : null;
  } catch {
    return null;
  }
});

/** For pages that need a signed-in user: sends everyone else to login and back again. */
export async function requireUser(returnTo: string): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return user;
}

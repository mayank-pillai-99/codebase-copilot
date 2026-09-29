import { healthResponseSchema, type HealthResponse } from '@codebase-copilot/shared';

/** Server-side base URL of the Fastify API. Browser code should call relative `/api/*` paths instead. */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export type HealthResult = { reachable: true; health: HealthResponse } | { reachable: false };

export async function fetchHealth(): Promise<HealthResult> {
  try {
    // 503 still carries a valid body describing which dependency is down.
    const res = await fetch(`${API_URL}/api/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    const parsed = healthResponseSchema.safeParse(await res.json());
    return parsed.success ? { reachable: true, health: parsed.data } : { reachable: false };
  } catch {
    return { reachable: false };
  }
}

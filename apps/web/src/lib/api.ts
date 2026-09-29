import 'server-only';
import { healthResponseSchema, type HealthResponse } from '@codebase-copilot/shared';
import { API_URL } from './config';

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

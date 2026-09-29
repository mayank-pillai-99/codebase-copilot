import type { DependencyStatus, HealthResponse } from '@codebase-copilot/shared';

/** Resolves (optionally with a detail string) when healthy; throws when not. */
export type HealthCheck = () => Promise<string | void>;

export interface HealthChecks {
  database: HealthCheck;
  pgvector: HealthCheck;
  redis: HealthCheck;
}

const CHECK_TIMEOUT_MS = 2_000;

async function runCheck(check: HealthCheck): Promise<DependencyStatus> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const detail = await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, latencyMs: elapsed(started), ...(detail && { detail }) };
  } catch (err) {
    return { ok: false, latencyMs: elapsed(started), detail: errorMessage(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealth(
  checks: HealthChecks,
  meta: { version: string; startedAt: number },
): Promise<HealthResponse> {
  const [database, pgvector, redis] = await Promise.all([
    runCheck(checks.database),
    runCheck(checks.pgvector),
    runCheck(checks.redis),
  ]);
  const dependencies = { database, pgvector, redis };
  return {
    status: Object.values(dependencies).every((d) => d.ok) ? 'ok' : 'degraded',
    version: meta.version,
    uptimeSeconds: Math.round((Date.now() - meta.startedAt) / 1000),
    dependencies,
  };
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

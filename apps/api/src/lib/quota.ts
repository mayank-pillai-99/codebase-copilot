import type { Redis } from './redis';

export interface DailyQuota {
  /** Counts one use and returns whether the key is still within today's limit. */
  consume(key: string): Promise<boolean>;
}

/**
 * Per-key daily counters in Redis (UTC days). Protects the free LLM quota from one
 * user or IP exhausting it. If Redis is unavailable, requests are allowed rather
 * than blocked, the same trade-off as the rate limiter.
 */
export function createDailyQuota(redis: Redis, name: string, limit: number): DailyQuota {
  return {
    async consume(key) {
      const day = new Date().toISOString().slice(0, 10);
      const redisKey = `quota:${name}:${day}:${key}`;
      try {
        const used = await redis.incr(redisKey);
        if (used === 1) await redis.expire(redisKey, 2 * 24 * 60 * 60);
        return used <= limit;
      } catch {
        return true;
      }
    },
  };
}

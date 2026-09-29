import { Redis } from 'ioredis';

/**
 * Single place that knows how Redis connections are created, so the provider
 * (local, Upstash, …) can change without touching callers.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    // Fail fast instead of queueing commands forever while Redis is down.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

/** BullMQ needs its own connections that retry indefinitely instead of failing fast. */
export function createQueueRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export type { Redis };

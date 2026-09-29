import type { PrismaClient } from '../lib/prisma';
import type { Redis } from '../lib/redis';
import type { HealthChecks } from './health.service';

export function createDependencyChecks(prisma: PrismaClient, redis: Redis): HealthChecks {
  return {
    database: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    pgvector: async () => {
      const rows = await prisma.$queryRaw<{ extversion: string }[]>`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `;
      const version = rows[0]?.extversion;
      if (!version) throw new Error('pgvector extension is not installed (run migrations)');
      return `v${version}`;
    },
    redis: async () => {
      if (redis.status === 'wait') await redis.connect();
      await redis.ping();
    },
  };
}

import type { Worker } from 'bullmq';
import { buildApp } from './app';
import { EnvError, parseEnv } from './config/env';
import { createIndexerFromEnv } from './indexing/setup';
import { argon2Hasher } from './lib/password';
import { createPrisma } from './lib/prisma';
import { createQueueRedis, createRedis, type Redis } from './lib/redis';
import { startIndexingWorker } from './queue/indexing-queue';
import { createUserRepository } from './repositories/user.repository';
import { createAuthService } from './services/auth.service';
import { createDependencyChecks } from './services/dependency-checks';

async function main(): Promise<void> {
  const env = parseEnv();
  const prisma = createPrisma(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  // Redis being down must not crash the API; health reports it and ioredis keeps reconnecting.
  redis.on('error', () => undefined);
  redis.connect().catch(() => undefined);

  const app = await buildApp({
    env,
    healthChecks: createDependencyChecks(prisma, redis),
    auth: createAuthService({ users: createUserRepository(prisma), hasher: argon2Hasher }),
    redis,
  });

  let worker: Worker | undefined;
  let workerConnection: Redis | undefined;
  if (env.RUN_WORKER_IN_PROCESS) {
    workerConnection = createQueueRedis(env.REDIS_URL);
    worker = startIndexingWorker(
      workerConnection,
      createIndexerFromEnv(env, prisma, app.log),
      app.log,
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await worker?.close();
    await Promise.allSettled([prisma.$disconnect(), redis.quit(), workerConnection?.quit()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err: unknown) => {
  // The logger may not exist yet (e.g. invalid env), so fall back to stderr.
  console.error(err instanceof EnvError ? err.message : err);
  process.exit(1);
});

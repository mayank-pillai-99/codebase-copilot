import pino from 'pino';
import { EnvError, parseEnv } from './config/env';
import { createIndexerFromEnv } from './indexing/setup';
import { createPrisma } from './lib/prisma';
import { createQueueRedis } from './lib/redis';
import { startIndexingWorker } from './queue/indexing-queue';

/** Standalone indexing worker (docker compose `worker` service). */
async function main(): Promise<void> {
  const env = parseEnv();
  const logger = pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      },
    }),
  });
  const prisma = createPrisma(env.DATABASE_URL);
  const connection = createQueueRedis(env.REDIS_URL);
  const worker = startIndexingWorker(connection, createIndexerFromEnv(env, prisma, logger), logger);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker');
    // Lets the current job finish; an interrupted job is picked up again as stalled.
    await worker.close();
    await Promise.allSettled([prisma.$disconnect(), connection.quit()]);
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  // Keep indexing through stray third-party rejections instead of dropping the current job.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof EnvError ? err.message : err);
  process.exit(1);
});

import { buildApp } from './app';
import { EnvError, parseEnv } from './config/env';
import { createPrisma } from './lib/prisma';
import { createRedis } from './lib/redis';
import { createDependencyChecks } from './services/dependency-checks';

async function main(): Promise<void> {
  const env = parseEnv();
  const prisma = createPrisma(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  // Redis being down must not crash the API; health reports it instead.
  redis.on('error', () => undefined);

  const app = await buildApp({ env, healthChecks: createDependencyChecks(prisma, redis) });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
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

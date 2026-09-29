import type { Worker } from 'bullmq';
import { buildApp } from './app';
import { EnvError, parseEnv } from './config/env';
import { createGitHubClient } from './github/client';
import { createChatService } from './chat/chat.service';
import { createIndexerFromEnv } from './indexing/setup';
import { argon2Hasher } from './lib/password';
import { createPrisma } from './lib/prisma';
import { createDailyQuota } from './lib/quota';
import { createQueueRedis, createRedis, type Redis } from './lib/redis';
import { createIndexingQueue, startIndexingWorker } from './queue/indexing-queue';
import { createFullTextRetriever } from './retrieval/fulltext';
import { createHybridRetriever } from './retrieval/hybrid';
import { createVectorRetriever } from './retrieval/vector';
import { createGeminiChatModel, withFallbacks } from './llm/chat-model';
import { GeminiEmbeddings } from './llm/embeddings';
import { createUserRepository } from './repositories/user.repository';
import { createAuthService } from './services/auth.service';
import { createCodeService } from './services/code.service';
import { createDependencyChecks } from './services/dependency-checks';
import { createRepositoryService } from './services/repository.service';
import { parseDemoRepositories } from './services/snapshot-access';

async function main(): Promise<void> {
  const env = parseEnv();
  const prisma = createPrisma(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  // Redis being down must not crash the API; health reports it and ioredis keeps reconnecting.
  redis.on('error', () => undefined);
  redis.connect().catch(() => undefined);

  const demo = parseDemoRepositories(env.DEMO_REPOSITORIES);
  const queueConnection = createQueueRedis(env.REDIS_URL);
  queueConnection.on('error', () => undefined);
  const queue = createIndexingQueue(queueConnection);

  const embeddings = env.GEMINI_API_KEY
    ? new GeminiEmbeddings({ apiKey: env.GEMINI_API_KEY, model: env.EMBEDDING_MODEL })
    : null;
  const retriever = createHybridRetriever(
    prisma,
    createVectorRetriever(prisma, embeddings),
    createFullTextRetriever(prisma),
  );
  const chatModels = [env.LLM_MODEL, ...env.LLM_FALLBACK_MODELS.split(',')]
    .map((model) => model.trim())
    .filter((model, i, all) => model && all.indexOf(model) === i);
  const geminiKey = env.GEMINI_API_KEY;
  const chatModel = geminiKey
    ? withFallbacks(chatModels.map((model) => createGeminiChatModel({ apiKey: geminiKey, model })))
    : null;

  // The chat service logs through the app's pino logger, which exists once the app is built.
  const appLogger = {
    info: (obj: object, msg?: string) => app.log.info(obj, msg),
    warn: (obj: object, msg?: string) => app.log.warn(obj, msg),
    error: (obj: object, msg?: string) => app.log.error(obj, msg),
  };
  const repositories = createRepositoryService({
    prisma,
    github: createGitHubClient({ token: env.GITHUB_TOKEN }),
    queue,
    demo,
  });
  const app = await buildApp({
    env,
    healthChecks: createDependencyChecks(prisma, redis),
    auth: createAuthService({ users: createUserRepository(prisma), hasher: argon2Hasher }),
    repositories,
    chat: createChatService({ prisma, retriever, model: chatModel, logger: appLogger, demo }),
    code: createCodeService(prisma, demo),
    chatQuota: {
      user: createDailyQuota(redis, 'chat', env.CHAT_DAILY_LIMIT),
      anonymous: createDailyQuota(redis, 'demo-chat', env.DEMO_CHAT_DAILY_LIMIT),
    },
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
    await queue.close();
    await Promise.allSettled([
      prisma.$disconnect(),
      redis.quit(),
      queueConnection.quit(),
      workerConnection?.quit(),
    ]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.HOST, port: env.PORT });

  // Index demo repositories in the background; the API is usable meanwhile.
  if (demo.length) {
    repositories
      .seedDemo()
      .then(() => app.log.info({ demo: demo.length }, 'demo repositories checked'))
      .catch((err: unknown) => app.log.error({ err }, 'seeding demo repositories failed'));
  }
}

main().catch((err: unknown) => {
  // The logger may not exist yet (e.g. invalid env), so fall back to stderr.
  console.error(err instanceof EnvError ? err.message : err);
  process.exit(1);
});

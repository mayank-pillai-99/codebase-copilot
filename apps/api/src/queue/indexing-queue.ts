import { Queue, UnrecoverableError, Worker } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import { IndexingError, type Indexer } from '../indexing/indexer';
import type { Redis } from '../lib/redis';

export const INDEXING_QUEUE = 'indexing';
const ATTEMPTS = 3;

interface IndexingJob {
  snapshotId: string;
}

export interface IndexingQueue {
  enqueue(snapshotId: string): Promise<void>;
  close(): Promise<void>;
}

export function createIndexingQueue(connection: Redis, queueName = INDEXING_QUEUE): IndexingQueue {
  const queue = new Queue<IndexingJob>(queueName, {
    connection,
    defaultJobOptions: {
      attempts: ATTEMPTS,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 500 },
    },
  });

  return {
    async enqueue(snapshotId) {
      // The job id is the snapshot id, so double submissions don't index twice.
      // A finished job with that id must be removed before the snapshot can be re-indexed.
      const existing = await queue.getJob(snapshotId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'completed' || state === 'failed') await existing.remove();
        else return;
      }
      await queue.add('index-snapshot', { snapshotId }, { jobId: snapshotId });
    },
    close: () => queue.close(),
  };
}

export function startIndexingWorker(
  connection: Redis,
  indexer: Indexer,
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>,
  options: { queueName?: string; drainDelaySeconds?: number } = {},
): Worker<IndexingJob> {
  const queueName = options.queueName ?? INDEXING_QUEUE;
  const worker = new Worker<IndexingJob>(
    queueName,
    async (job) => {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      try {
        await indexer(job.data.snapshotId, { isFinalAttempt });
      } catch (err) {
        // The snapshot already shows the reason; don't spend retries on it.
        if (err instanceof IndexingError) throw new UnrecoverableError(err.message);
        throw err;
      }
    },
    {
      connection,
      // One repository at a time keeps memory bounded on small instances.
      concurrency: 1,
      // Free hosted Redis plans limit commands. Waiting longer between empty polls and
      // checking for stalled jobs less often cuts idle traffic considerably.
      drainDelay: options.drainDelaySeconds ?? 30,
      stalledInterval: 120_000,
      maxStalledCount: 1,
    },
  );
  worker.on('failed', (job, err) =>
    logger.error({ snapshotId: job?.data.snapshotId, err: err.message }, 'indexing job failed'),
  );
  worker.on('error', (err) => logger.error({ err }, 'indexing worker error'));
  logger.info({ queue: queueName }, 'indexing worker started');
  return worker;
}

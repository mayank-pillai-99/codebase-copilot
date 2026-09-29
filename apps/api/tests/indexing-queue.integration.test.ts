import { randomUUID } from 'node:crypto';
import type { Job, Worker } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexingError, type Indexer } from '../src/indexing/indexer';
import { createQueueRedis, type Redis } from '../src/lib/redis';
import {
  createIndexingQueue,
  startIndexingWorker,
  type IndexingQueue,
} from '../src/queue/indexing-queue';

const { REDIS_URL, RUN_INTEGRATION } = process.env;
const silent = { info: () => undefined, error: () => undefined };

describe.runIf(RUN_INTEGRATION === '1' && REDIS_URL)('indexing queue (integration)', () => {
  let connections: Redis[] = [];
  let queue: IndexingQueue | undefined;
  let worker: Worker | undefined;

  afterEach(async () => {
    await worker?.close();
    await queue?.close();
    await Promise.all(connections.map((c) => c.quit()));
    connections = [];
  });

  function setup(indexer: Indexer) {
    // A unique queue per test, so a running dev worker never picks these jobs up.
    const queueName = `test-indexing-${randomUUID()}`;
    const [a, b] = [createQueueRedis(REDIS_URL!), createQueueRedis(REDIS_URL!)];
    connections.push(a, b);
    queue = createIndexingQueue(a, queueName);
    worker = startIndexingWorker(b, indexer, silent, { queueName, drainDelaySeconds: 1 });
    return worker;
  }

  const nextEvent = (w: Worker, event: 'completed' | 'failed') =>
    new Promise<Job>((resolve) => w.once(event, (job: Job) => resolve(job)));

  it('runs the indexer for an enqueued snapshot, once even if submitted twice', async () => {
    const seen: string[] = [];
    const w = setup(async (id) => {
      seen.push(id);
    });
    const done = nextEvent(w, 'completed');

    await queue!.enqueue('snapshot-1');
    await queue!.enqueue('snapshot-1');
    await done;
    expect(seen).toEqual(['snapshot-1']);
  });

  it('lets a finished snapshot be queued again', async () => {
    let runs = 0;
    const w = setup(async () => {
      runs++;
    });

    let done = nextEvent(w, 'completed');
    await queue!.enqueue('snapshot-2');
    await done;
    done = nextEvent(w, 'completed');
    await queue!.enqueue('snapshot-2');
    await done;
    expect(runs).toBe(2);
  });

  it('does not retry failures the user has to fix', async () => {
    let runs = 0;
    const w = setup(async () => {
      runs++;
      throw new IndexingError('Repository has more than 2,000 source files, the current limit.');
    });
    const failed = nextEvent(w, 'failed');

    await queue!.enqueue('snapshot-3');
    const job = await failed;
    expect(runs).toBe(1);
    expect(job.failedReason).toMatch(/source files/);
  });

  it('tells the indexer whether this is the last attempt', async () => {
    const attempts: boolean[] = [];
    const w = setup(async (_id, { isFinalAttempt }) => {
      attempts.push(isFinalAttempt);
      throw new Error('transient');
    });
    const failed = nextEvent(w, 'failed');
    await queue!.enqueue('snapshot-4');
    await failed;
    // The first failure only schedules a retry (15 s backoff), so one call is seen here.
    expect(attempts).toEqual([false]);
  });
});

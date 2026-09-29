import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { evalRunSchema, type EvalRun } from '@codebase-copilot/shared';
import { EnvError, parseEnv, type Env } from '../config/env';
import { createGitHubClient } from '../github/client';
import { embedMissingChunks } from '../indexing/indexer';
import { createIndexerFromEnv } from '../indexing/setup';
import { createPrisma, type PrismaClient } from '../lib/prisma';
import { GeminiEmbeddings } from '../llm/embeddings';
import { createFullTextRetriever } from '../retrieval/fulltext';
import { createHybridRetriever } from '../retrieval/hybrid';
import { createVectorRetriever } from '../retrieval/vector';
import { saveEvalRun } from '../services/eval.service';
import { loadDataset, type EvalDataset } from './dataset';
import { createPrimedEmbedder, findMissingGold, runEval, type EvalTarget } from './runner';

/**
 * Retrieval evaluation (SPEC §8): npm run eval [-- --include-unreviewed] [-- --k 20]
 *
 * Indexes each pinned repository into the local database if needed, runs every
 * retriever on every reviewed question, then writes eval/results/<date>-<id>.json and
 * an eval_runs row. Runs over unreviewed drafts go to eval/drafts/ (gitignored) and
 * never reach the database, so they can't be published by accident.
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const log = (message: string) => process.stderr.write(`${message}\n`);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dataset: { type: 'string', default: join(ROOT, 'eval/datasets/v1') },
      'include-unreviewed': { type: 'boolean', default: false },
      k: { type: 'string', default: '20' },
    },
  });
  const k = Number(values.k);
  if (!Number.isInteger(k) || k < 10 || k > 50) throw new Error('--k must be between 10 and 50');
  const draft = values['include-unreviewed'];

  const env = parseEnv();
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required: vector and hybrid retrieval need embeddings.');
  }
  const dataset = await loadDataset(values.dataset);
  const questions = dataset.questions.filter((q) => draft || q.reviewed);
  if (questions.length === 0) {
    throw new Error(
      'No reviewed questions. Review the dataset first, or pass --include-unreviewed for a draft run.',
    );
  }
  log(`Dataset ${dataset.version}: ${questions.length} of ${dataset.questions.length} questions`);

  const prisma = createPrisma(env.DATABASE_URL);
  try {
    const snapshots = await ensureSnapshots(env, prisma, dataset, env.GEMINI_API_KEY);

    const missing = findMissingGold(questions, await pathsBySnapshot(prisma, snapshots));
    if (missing.length) {
      throw new Error(
        `Gold paths not found in the indexed snapshots:\n${missing.map((m) => `  ${m.id}: ${m.path}`).join('\n')}`,
      );
    }

    const embeddings = new GeminiEmbeddings({
      apiKey: env.GEMINI_API_KEY,
      model: env.EMBEDDING_MODEL,
    });
    const embedder = createPrimedEmbedder(embeddings);
    log(`Embedding ${questions.length} queries with ${embeddings.model}…`);
    await embedder.prime(questions.map((q) => q.question));

    const vector = createVectorRetriever(prisma, embedder);
    const fulltext = createFullTextRetriever(prisma);
    const targets: EvalTarget[] = [
      { label: 'vector', retriever: vector },
      { label: 'fulltext', retriever: fulltext },
      {
        label: 'hybrid (no graph)',
        retriever: createHybridRetriever(prisma, vector, fulltext, { graphExpansion: false }),
      },
      { label: 'hybrid', retriever: createHybridRetriever(prisma, vector, fulltext) },
    ];

    const report = await runEval({
      questions,
      snapshots,
      targets,
      k,
      onProgress: (done, total) => {
        if (done % 10 === 0 || done === total) log(`  ${done}/${total} questions`);
      },
    });

    const run: EvalRun = evalRunSchema.parse({
      id: randomUUID(),
      kind: 'retrieval',
      createdAt: new Date().toISOString(),
      datasetVersion: dataset.version,
      config: {
        k,
        embeddingModel: embeddings.model,
        repos: dataset.repos,
        questions: questions.length,
        questionSources: {
          human: questions.filter((q) => q.source === 'human').length,
          llmDrafted: questions.filter((q) => q.source === 'llm-drafted').length,
        },
        codeVersion: codeVersion(),
      },
      metrics: { retrievers: report.retrievers, queryEmbeddingMs: embedder.latency() },
      results: report.questions,
    });

    const dir = join(ROOT, draft ? 'eval/drafts' : 'eval/results');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${run.createdAt.slice(0, 10)}-${run.id.slice(0, 8)}.json`);
    await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
    if (!draft) await saveEvalRun(prisma, run);

    printSummary(run);
    log(
      `\nWrote ${file.replace(`${ROOT}/`, '')}${draft ? ' (draft: not saved to the database)' : ''}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Finds or creates a snapshot per pinned commit and makes sure every chunk has a vector
 * from the configured model. Parsing happens once; embeddings are then filled in with
 * small batches and patient retries, saved as they go, because the free Gemini tier
 * rate-limits bulk embedding. An interrupted run resumes where it stopped. Eval
 * snapshots aren't tracked by any user, so they never show up in the app.
 */
async function ensureSnapshots(
  env: Env,
  prisma: PrismaClient,
  dataset: EvalDataset,
  apiKey: string,
): Promise<Map<string, string>> {
  const github = createGitHubClient({ token: env.GITHUB_TOKEN });
  // Index without embeddings; the backfill below embeds, resumably.
  const index = createIndexerFromEnv({ ...env, GEMINI_API_KEY: undefined }, prisma, {
    info: () => undefined,
    warn: (obj: object, msg?: string) => log(`  warning: ${msg ?? ''} ${JSON.stringify(obj)}`),
    error: (obj: object, msg?: string) => log(`  error: ${msg ?? ''} ${JSON.stringify(obj)}`),
  });
  const embedder = new GeminiEmbeddings({
    apiKey,
    model: env.EMBEDDING_MODEL,
    batchSize: 20,
    maxAttempts: 12,
  });
  const snapshots = new Map<string, string>();

  for (const { repo, sha } of dataset.repos) {
    const [owner, name] = repo.split('/') as [string, string];
    let repository = await prisma.repository.findFirst({
      where: {
        owner: { equals: owner, mode: 'insensitive' },
        name: { equals: name, mode: 'insensitive' },
      },
    });
    if (!repository) {
      const meta = await github.getRepository(owner, name);
      repository = await prisma.repository.create({
        data: { owner: meta.owner, name: meta.name, defaultBranch: meta.defaultBranch },
      });
    }
    const snapshot = await prisma.snapshot.upsert({
      where: { repositoryId_commitSha: { repositoryId: repository.id, commitSha: sha } },
      update: {},
      create: { repositoryId: repository.id, commitSha: sha, ref: sha },
    });
    const label = `${repo} @ ${sha.slice(0, 7)}`;

    if (snapshot.status !== 'READY') {
      log(`${label}: indexing…`);
      await index(snapshot.id, { isFinalAttempt: true });
      const indexed = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
      if (indexed.status !== 'READY') {
        throw new Error(`${repo} failed to index: ${indexed.failureReason ?? 'unknown reason'}`);
      }
    }
    if (
      !isFullyEmbedded(
        await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } }),
        env.EMBEDDING_MODEL,
      )
    ) {
      let lastLog = 0;
      await embedMissingChunks(
        {
          prisma,
          embedder,
          batchSize: 20,
          onProgress: (done, total) => {
            if (Date.now() - lastLog > 15_000 || done === total) {
              lastLog = Date.now();
              log(`${label}: embedded ${done}/${total} chunks`);
            }
          },
        },
        snapshot.id,
      );
    }
    log(`${label}: ready`);
    snapshots.set(repo, snapshot.id);
  }
  return snapshots;
}

function isFullyEmbedded(snapshot: { stats: unknown }, model: string): boolean {
  const embeddings = (snapshot.stats as { embeddings?: { status?: string; model?: string } })
    ?.embeddings;
  return embeddings?.status === 'complete' && embeddings.model === model;
}

async function pathsBySnapshot(prisma: PrismaClient, snapshots: Map<string, string>) {
  const result = new Map<string, Set<string>>();
  for (const [repo, snapshotId] of snapshots) {
    const files = await prisma.file.findMany({ where: { snapshotId }, select: { path: true } });
    result.set(repo, new Set(files.map((f) => f.path)));
  }
  return result;
}

function codeVersion(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })
      .toString()
      .trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages'], {
      cwd: ROOT,
    })
      .toString()
      .trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

function printSummary(run: EvalRun): void {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`.padStart(7);
  log(
    `\n${'retriever'.padEnd(20)} ${'R@5'.padStart(7)} ${'R@10'.padStart(7)}   MRR  nDCG@10  p50 ms`,
  );
  for (const r of run.metrics.retrievers) {
    const o = r.overall;
    log(
      `${r.label.padEnd(20)} ${pct(o.recall5)} ${pct(o.recall10)} ${o.mrr.toFixed(3)}   ${o.ndcg10.toFixed(3)}  ${String(Math.round(r.latencyMs.p50)).padStart(6)}`,
    );
  }
  const e = run.metrics.queryEmbeddingMs;
  log(`Query embedding: p50 ${e.p50} ms, p95 ${e.p95} ms over ${e.calls} calls`);
}

main().catch((err: unknown) => {
  log(err instanceof EnvError || err instanceof Error ? err.message : String(err));
  process.exit(1);
});

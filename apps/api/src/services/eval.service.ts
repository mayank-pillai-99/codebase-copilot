import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evalRunSchema, type EvalRun } from '@codebase-copilot/shared';
import type { PrismaClient } from '../lib/prisma';

export interface EvalService {
  /** The most recent retrieval evaluation, or null if none has been run. */
  latest(): Promise<EvalRun | null>;
}

export function createEvalService(prisma: PrismaClient): EvalService {
  return {
    async latest() {
      const row = await prisma.evalRun.findFirst({
        where: { kind: 'retrieval' },
        orderBy: { createdAt: 'desc' },
      });
      if (!row) return null;
      return evalRunSchema.parse({
        id: row.id,
        kind: row.kind,
        createdAt: row.createdAt.toISOString(),
        datasetVersion: row.datasetVersion,
        config: row.config,
        metrics: row.metrics,
        results: row.results,
      });
    },
  };
}

export async function saveEvalRun(prisma: PrismaClient, run: EvalRun): Promise<void> {
  await prisma.evalRun.create({
    data: {
      id: run.id,
      kind: run.kind,
      createdAt: new Date(run.createdAt),
      datasetVersion: run.datasetVersion,
      config: run.config,
      metrics: run.metrics,
      results: run.results,
    },
  });
}

/**
 * Loads committed result files (eval/results/*.json) into the database, skipping runs
 * already there. Runs happen locally; this is how their results reach a deployment.
 * Returns the number of runs added.
 */
export async function importEvalResults(prisma: PrismaClient, dir: string): Promise<number> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  const runs = await Promise.all(
    names.map(async (name) => {
      const parsed = evalRunSchema.safeParse(JSON.parse(await readFile(join(dir, name), 'utf8')));
      if (!parsed.success) throw new Error(`${name} is not a valid evaluation run`);
      return parsed.data;
    }),
  );
  const existing = new Set(
    (
      await prisma.evalRun.findMany({
        where: { id: { in: runs.map((r) => r.id) } },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  const added = runs.filter((r) => !existing.has(r.id));
  for (const run of added) await saveEvalRun(prisma, run);
  return added.length;
}

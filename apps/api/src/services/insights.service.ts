import { insightsSchema, type Insights } from '@codebase-copilot/shared';
import { computeInsights } from '../analysis/insights';
import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';
import { findVisibleSnapshot, type DemoRepositories } from './snapshot-access';

export interface InsightsService {
  /** viewerId is null for anonymous visitors (demo repositories only). */
  getInsights(viewerId: string | null, snapshotId: string): Promise<Insights>;
}

/** Bump when the analysis changes, so cached insights are rebuilt. */
export const INSIGHTS_VERSION = 1;

/** Codebase health from the stored graph, computed on first request and cached. */
export function createInsightsService(
  prisma: PrismaClient,
  demo: DemoRepositories = [],
): InsightsService {
  return {
    async getInsights(viewerId, snapshotId) {
      const snapshot = await findVisibleSnapshot(prisma, viewerId, snapshotId, demo);
      if (snapshot.status !== 'READY') {
        throw new AppError(409, 'This snapshot is still being indexed.');
      }
      const where = { snapshotId_kind: { snapshotId, kind: 'insights' } };
      const cached = await prisma.snapshotAnalysis.findUnique({ where });
      if (cached?.version === INSIGHTS_VERSION) return insightsSchema.parse(cached.data);

      const [files, symbols, imports, calls] = await Promise.all([
        prisma.file.findMany({
          where: { snapshotId },
          select: { id: true, path: true, kind: true, lineCount: true },
        }),
        prisma.symbol.findMany({
          where: { snapshotId, kind: { in: ['FUNCTION', 'METHOD', 'CLASS'] } },
          select: {
            id: true,
            fileId: true,
            qualifiedName: true,
            kind: true,
            startLine: true,
            endLine: true,
          },
        }),
        prisma.importEdge.findMany({
          where: { snapshotId, toFileId: { not: null } },
          select: { fromFileId: true, toFileId: true },
        }),
        prisma.callEdge.findMany({
          where: { snapshotId, resolved: true, toSymbolId: { not: null } },
          select: { fileId: true, toSymbolId: true },
        }),
      ]);
      const pathOf = new Map(files.map((f) => [f.id, f.path]));

      const insights = computeInsights({
        files,
        symbols: symbols.map(({ fileId, ...s }) => ({ ...s, path: pathOf.get(fileId)! })),
        imports: imports.map((i) => ({
          from: pathOf.get(i.fromFileId)!,
          to: pathOf.get(i.toFileId!)!,
        })),
        calls: calls.map((c) => ({ fromPath: pathOf.get(c.fileId)!, toSymbolId: c.toSymbolId! })),
      });
      await prisma.snapshotAnalysis.upsert({
        where,
        create: { snapshotId, kind: 'insights', version: INSIGHTS_VERSION, data: insights },
        update: { version: INSIGHTS_VERSION, data: insights, createdAt: new Date() },
      });
      return insights;
    },
  };
}

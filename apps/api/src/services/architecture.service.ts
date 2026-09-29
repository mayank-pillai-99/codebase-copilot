import { architectureSchema, type Architecture } from '@codebase-copilot/shared';
import { buildArchitecture } from '../analysis/architecture';
import { detectDataModels, detectEnvVars, detectIntegrations } from '../analysis/integrations';
import { classifyRole } from '../analysis/components';
import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';
import { findVisibleSnapshot, type DemoRepositories } from './snapshot-access';

export interface ArchitectureService {
  /** viewerId is null for anonymous visitors (demo repositories only). */
  getArchitecture(viewerId: string | null, snapshotId: string): Promise<Architecture>;
}

/** Bump when the analysis changes, so cached maps are rebuilt. */
export const ARCHITECTURE_VERSION = 1;

export function createArchitectureService(
  prisma: PrismaClient,
  demo: DemoRepositories = [],
): ArchitectureService {
  return {
    async getArchitecture(viewerId, snapshotId) {
      const snapshot = await findVisibleSnapshot(prisma, viewerId, snapshotId, demo);
      if (snapshot.status !== 'READY') {
        throw new AppError(409, 'This snapshot is still being indexed.');
      }
      const cached = await prisma.snapshotAnalysis.findUnique({
        where: { snapshotId_kind: { snapshotId, kind: 'architecture' } },
      });
      if (cached?.version === ARCHITECTURE_VERSION) return architectureSchema.parse(cached.data);

      const architecture = await analyze(prisma, snapshotId);
      await prisma.snapshotAnalysis.upsert({
        where: { snapshotId_kind: { snapshotId, kind: 'architecture' } },
        create: {
          snapshotId,
          kind: 'architecture',
          version: ARCHITECTURE_VERSION,
          data: architecture,
        },
        update: { version: ARCHITECTURE_VERSION, data: architecture, createdAt: new Date() },
      });
      return architecture;
    },
  };
}

/** Builds the map from the stored code graph; file contents are read once, here. */
async function analyze(prisma: PrismaClient, snapshotId: string): Promise<Architecture> {
  const [files, imports, routes, symbolCounts] = await Promise.all([
    prisma.file.findMany({
      where: { snapshotId },
      select: { id: true, path: true, kind: true, language: true },
    }),
    prisma.importEdge.findMany({
      where: { snapshotId },
      select: {
        fromFileId: true,
        toFileId: true,
        specifier: true,
        line: true,
        external: true,
        packageName: true,
      },
    }),
    prisma.route.findMany({ where: { snapshotId }, select: { fileId: true } }),
    prisma.symbol.groupBy({ by: ['fileId'], where: { snapshotId }, _count: { _all: true } }),
  ]);
  const pathOf = new Map(files.map((f) => [f.id, f.path]));

  // Contents are needed only for env vars, data models and dependency declarations.
  const scanned = await prisma.file.findMany({
    where: {
      snapshotId,
      OR: [{ kind: 'CODE' }, { language: 'prisma' }, { path: { endsWith: 'package.json' } }],
    },
    select: { path: true, content: true, language: true, kind: true },
  });
  const applicationCode = scanned.filter(
    (f) => f.kind === 'CODE' && classifyRole(f.path) !== 'test',
  );
  const isApplicationCode = new Set(applicationCode);

  return buildArchitecture({
    codeFiles: files.filter((f) => f.kind === 'CODE').map((f) => f.path),
    symbolsPerFile: new Map(symbolCounts.map((s) => [pathOf.get(s.fileId)!, s._count._all])),
    routeFiles: routes.map((r) => pathOf.get(r.fileId)!),
    internalImports: imports.flatMap((i) =>
      i.toFileId
        ? [
            {
              from: pathOf.get(i.fromFileId)!,
              to: pathOf.get(i.toFileId)!,
              specifier: i.specifier,
              line: i.line,
            },
          ]
        : [],
    ),
    integrations: detectIntegrations(
      imports.flatMap((i) =>
        i.external && i.packageName
          ? [{ file: pathOf.get(i.fromFileId)!, line: i.line, packageName: i.packageName }]
          : [],
      ),
      scanned.filter((f) => f.path === 'package.json' || f.path.endsWith('/package.json')),
    ),
    dataModels: detectDataModels(
      scanned.filter((f) => f.language === 'prisma' || isApplicationCode.has(f)),
    ),
    envVars: detectEnvVars(applicationCode),
  });
}

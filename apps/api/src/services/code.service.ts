import type {
  FileEntry,
  FileResponse,
  ImpactResponse,
  ReferencesResponse,
} from '@codebase-copilot/shared';
import { computeImpact } from '../analysis/impact';
import { isTestFile } from '../analysis/insights';
import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';
import { findVisibleSnapshot, type DemoRepositories } from './snapshot-access';

export interface CodeService {
  /** viewerId is null for anonymous visitors (demo repositories only). */
  listFiles(viewerId: string | null, snapshotId: string): Promise<FileEntry[]>;
  getFile(viewerId: string | null, snapshotId: string, path: string): Promise<FileResponse>;
  /** Callers and callees of the innermost symbol containing `line` in `path`. */
  getReferences(
    viewerId: string | null,
    snapshotId: string,
    path: string,
    line: number,
  ): Promise<ReferencesResponse>;
  /** What may be affected by changing the innermost symbol containing `line` in `path`. */
  getImpact(
    viewerId: string | null,
    snapshotId: string,
    path: string,
    line: number,
  ): Promise<ImpactResponse>;
}

const MAX_REFERENCES = 50;

/** Read access to a snapshot's stored files, for the code viewer. */
export function createCodeService(prisma: PrismaClient, demo: DemoRepositories = []): CodeService {
  return {
    async listFiles(viewerId, snapshotId) {
      await findVisibleSnapshot(prisma, viewerId, snapshotId, demo);
      return prisma.file.findMany({
        where: { snapshotId },
        orderBy: { path: 'asc' },
        select: { path: true, kind: true, language: true, lineCount: true, sizeBytes: true },
      });
    },

    async getFile(viewerId, snapshotId, path) {
      await findVisibleSnapshot(prisma, viewerId, snapshotId, demo);
      const file = await prisma.file.findUnique({
        where: { snapshotId_path: { snapshotId, path } },
        include: {
          symbols: {
            orderBy: { startLine: 'asc' },
            select: {
              kind: true,
              name: true,
              qualifiedName: true,
              startLine: true,
              endLine: true,
              exported: true,
            },
          },
        },
      });
      if (!file) throw new AppError(404, 'File not found in this snapshot');
      return {
        file: {
          path: file.path,
          kind: file.kind,
          language: file.language,
          lineCount: file.lineCount,
          sizeBytes: file.sizeBytes,
          content: file.content,
          hasErrors: file.hasErrors,
        },
        symbols: file.symbols,
      };
    },

    async getReferences(viewerId, snapshotId, path, line) {
      const { file, symbol } = await symbolAt(prisma, demo, viewerId, snapshotId, path, line);
      if (!symbol) return { symbol: null, routes: [], callers: [], callees: [], truncated: false };

      // A class's own calls are its constructor's; its methods are separate symbols.
      let range = { startLine: symbol.startLine, endLine: symbol.endLine };
      let followBody = true;
      if (symbol.kind === 'CLASS') {
        const constructor = await prisma.symbol.findFirst({
          where: { fileId: file.id, qualifiedName: `${symbol.qualifiedName}.constructor` },
          select: { startLine: true, endLine: true },
        });
        if (constructor) range = constructor;
        else followBody = false;
      }

      const [routes, callerEdges, calleeEdges] = await Promise.all([
        prisma.route.findMany({
          where: { snapshotId, handlerSymbolId: symbol.id },
          orderBy: [{ path: 'asc' }, { method: 'asc' }],
          select: { id: true, method: true, path: true },
        }),
        prisma.callEdge.findMany({
          where: { snapshotId, toSymbolId: symbol.id, resolved: true },
          orderBy: [{ fileId: 'asc' }, { line: 'asc' }],
          take: MAX_REFERENCES + 1,
          select: {
            line: true,
            fileId: true,
            file: { select: { path: true } },
            fromSymbol: {
              select: {
                qualifiedName: true,
                startLine: true,
                endLine: true,
                file: { select: { path: true } },
              },
            },
          },
        }),
        followBody
          ? prisma.callEdge.findMany({
              where: {
                snapshotId,
                fileId: file.id,
                line: { gte: range.startLine, lte: range.endLine },
              },
              orderBy: [{ line: 'asc' }, { calleeText: 'asc' }],
              select: {
                calleeText: true,
                line: true,
                resolved: true,
                toSymbol: {
                  select: {
                    qualifiedName: true,
                    startLine: true,
                    endLine: true,
                    file: { select: { path: true } },
                  },
                },
              },
            })
          : Promise.resolve([]),
      ]);

      // Calls from inline route handlers have no enclosing symbol; name them by route.
      const anonymous = callerEdges.filter((e) => !e.fromSymbol);
      const inlineRoutes = anonymous.length
        ? await prisma.route.findMany({
            where: { snapshotId, fileId: { in: [...new Set(anonymous.map((e) => e.fileId))] } },
            select: {
              id: true,
              method: true,
              path: true,
              fileId: true,
              startLine: true,
              endLine: true,
            },
          })
        : [];
      const routeAt = (fileId: string, at: number) => {
        const route = inlineRoutes.find(
          (r) => r.fileId === fileId && at >= r.startLine && at <= r.endLine,
        );
        return route ? { id: route.id, method: route.method, path: route.path } : null;
      };

      // A chain like a.b().c() can repeat a callee on one line.
      const callees = calleeEdges.filter(
        (e, i) =>
          calleeEdges.findIndex((o) => o.line === e.line && o.calleeText === e.calleeText) === i,
      );
      const location = (s: {
        qualifiedName: string;
        startLine: number;
        endLine: number;
        file: { path: string };
      }) => ({
        label: s.qualifiedName,
        path: s.file.path,
        startLine: s.startLine,
        endLine: s.endLine,
      });

      return {
        symbol: {
          qualifiedName: symbol.qualifiedName,
          kind: symbol.kind.toLowerCase(),
          path,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
        },
        routes,
        callers: callerEdges.slice(0, MAX_REFERENCES).map((e) => ({
          from: e.fromSymbol ? location(e.fromSymbol) : null,
          route: e.fromSymbol ? null : routeAt(e.fileId, e.line),
          path: e.file.path,
          line: e.line,
        })),
        callees: callees.slice(0, MAX_REFERENCES).map((e) => ({
          callee: e.calleeText,
          line: e.line,
          resolved: e.resolved,
          target: e.toSymbol ? location(e.toSymbol) : null,
        })),
        truncated: callerEdges.length > MAX_REFERENCES || callees.length > MAX_REFERENCES,
      };
    },

    async getImpact(viewerId, snapshotId, path, line) {
      const { symbol } = await symbolAt(prisma, demo, viewerId, snapshotId, path, line);
      if (!symbol) {
        return {
          symbol: null,
          routes: [],
          dependents: [],
          tests: [],
          hasTests: false,
          truncated: false,
        };
      }
      const [files, symbols, calls, routes] = await Promise.all([
        prisma.file.findMany({
          where: { snapshotId, kind: 'CODE' },
          select: { id: true, path: true },
        }),
        prisma.symbol.findMany({
          where: { snapshotId },
          select: {
            id: true,
            fileId: true,
            qualifiedName: true,
            kind: true,
            startLine: true,
            endLine: true,
          },
        }),
        prisma.callEdge.findMany({
          where: { snapshotId, resolved: true, toSymbolId: { not: null } },
          select: { fromSymbolId: true, toSymbolId: true, fileId: true, line: true },
        }),
        prisma.route.findMany({
          where: { snapshotId },
          select: {
            id: true,
            method: true,
            path: true,
            fileId: true,
            handlerSymbolId: true,
            startLine: true,
            endLine: true,
          },
        }),
      ]);
      const pathOf = new Map(files.map((f) => [f.id, f.path]));
      const known = (fileId: string) => pathOf.has(fileId);

      // Changing a class can affect callers of any of its methods.
      const targets = [symbol.id];
      if (symbol.kind === 'CLASS') {
        const prefix = `${symbol.qualifiedName}.`;
        for (const s of symbols) {
          if (s.fileId === symbol.fileId && s.qualifiedName.startsWith(prefix)) targets.push(s.id);
        }
      }

      const impact = computeImpact({
        symbols: symbols
          .filter((s) => known(s.fileId))
          .map(({ fileId, ...s }) => ({ ...s, path: pathOf.get(fileId)! })),
        calls: calls
          .filter((c) => known(c.fileId))
          .map((c) => ({
            fromSymbolId: c.fromSymbolId,
            toSymbolId: c.toSymbolId!,
            path: pathOf.get(c.fileId)!,
            line: c.line,
          })),
        routes: routes
          .filter((r) => known(r.fileId))
          .map(({ fileId, ...r }) => ({ ...r, filePath: pathOf.get(fileId)! })),
        targets,
        hasTests: files.some((f) => isTestFile(f.path)),
      });
      return {
        symbol: {
          qualifiedName: symbol.qualifiedName,
          kind: symbol.kind.toLowerCase(),
          path,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
        },
        ...impact,
      };
    },
  };
}

/** The tightest symbol around a line (a method rather than its class), if any. */
async function symbolAt(
  prisma: PrismaClient,
  demo: DemoRepositories,
  viewerId: string | null,
  snapshotId: string,
  path: string,
  line: number,
) {
  const snapshot = await findVisibleSnapshot(prisma, viewerId, snapshotId, demo);
  if (snapshot.status !== 'READY') {
    throw new AppError(409, 'This snapshot is still being indexed.');
  }
  const file = await prisma.file.findUnique({
    where: { snapshotId_path: { snapshotId, path } },
    select: { id: true },
  });
  if (!file) throw new AppError(404, 'File not found in this snapshot');
  const symbol = (
    await prisma.symbol.findMany({
      where: { fileId: file.id, startLine: { lte: line }, endLine: { gte: line } },
      select: {
        id: true,
        fileId: true,
        qualifiedName: true,
        kind: true,
        startLine: true,
        endLine: true,
      },
    })
  ).sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
  return { file, symbol };
}

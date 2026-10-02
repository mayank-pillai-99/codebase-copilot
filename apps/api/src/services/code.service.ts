import type { FileEntry, FileResponse, ReferencesResponse } from '@codebase-copilot/shared';
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
      const snapshot = await findVisibleSnapshot(prisma, viewerId, snapshotId, demo);
      if (snapshot.status !== 'READY') {
        throw new AppError(409, 'This snapshot is still being indexed.');
      }
      const file = await prisma.file.findUnique({
        where: { snapshotId_path: { snapshotId, path } },
        select: { id: true },
      });
      if (!file) throw new AppError(404, 'File not found in this snapshot');

      // The tightest symbol around the line: a method rather than its class.
      const symbol = (
        await prisma.symbol.findMany({
          where: { fileId: file.id, startLine: { lte: line }, endLine: { gte: line } },
          select: { id: true, qualifiedName: true, kind: true, startLine: true, endLine: true },
        })
      ).sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
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
  };
}

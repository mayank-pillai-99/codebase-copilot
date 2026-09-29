import type { TraceNode, TraceResponse } from '@codebase-copilot/shared';
import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';
import { findVisibleSnapshot, isUuid, type DemoRepositories } from './snapshot-access';

export interface TraceService {
  /** viewerId is null for anonymous visitors (demo repositories only). */
  trace(viewerId: string | null, snapshotId: string, routeId: string): Promise<TraceResponse>;
}

const MAX_DEPTH = 4;
const MAX_NODES = 40;
const MAX_CALLS_PER_NODE = 30;
// The registration call itself (router.post(...)) sits on the route's first line.
const REGISTRATION = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'all',
  'route',
  'use',
  'head',
  'options',
]);

interface Span {
  id: string;
  fileId: string;
  startLine: number;
  endLine: number;
}

/**
 * Request tracing (SPEC §9.2): breadth-first over resolved call edges from a route's
 * handler, depth-limited. Deterministic; call resolution is name-based and
 * approximate, so unresolved calls are listed rather than guessed at.
 */
export function createTraceService(
  prisma: PrismaClient,
  demo: DemoRepositories = [],
): TraceService {
  return {
    async trace(viewerId, snapshotId, routeId) {
      const snapshot = await findVisibleSnapshot(prisma, viewerId, snapshotId, demo);
      if (!isUuid(routeId)) throw new AppError(404, 'Route not found');
      const route = await prisma.route.findFirst({
        where: { id: routeId, snapshotId: snapshot.id },
        include: {
          file: { select: { path: true } },
          handlerSymbol: { include: { file: { select: { path: true } } } },
        },
      });
      if (!route) throw new AppError(404, 'Route not found');

      const handler = route.handlerSymbol;
      const root: TraceNode & Span = handler
        ? {
            id: handler.id,
            parentId: null,
            depth: 0,
            label: handler.qualifiedName,
            kind: handler.kind.toLowerCase(),
            path: handler.file.path,
            fileId: handler.fileId,
            startLine: handler.startLine,
            endLine: handler.endLine,
            calls: [],
          }
        : {
            id: 'handler',
            parentId: null,
            depth: 0,
            label: `${route.method} ${route.path} handler`,
            kind: 'inline handler',
            path: route.file.path,
            fileId: route.fileId,
            startLine: route.startLine,
            endLine: route.endLine,
            calls: [],
          };

      const nodes: (TraceNode & Span)[] = [root];
      const seen = new Set([root.id]);
      let truncated = false;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        // `new Foo()` resolves to the class; follow its constructor, not every method in it.
        if (node.kind === 'class' && !(await narrowToConstructor(node))) continue;
        const edges = await prisma.callEdge.findMany({
          where: {
            snapshotId: snapshot.id,
            fileId: node.fileId,
            line: { gte: node.startLine, lte: node.endLine },
          },
          orderBy: [{ line: 'asc' }, { calleeText: 'asc' }],
          select: {
            calleeName: true,
            calleeText: true,
            line: true,
            resolved: true,
            toSymbolId: true,
          },
        });
        const calls = edges.filter(
          (e, index) =>
            !(
              node.id === 'handler' &&
              e.line === route.startLine &&
              REGISTRATION.has(e.calleeName.toLowerCase())
            ) &&
            // A call chain like a.b().c() can repeat the same callee on one line.
            edges.findIndex((o) => o.line === e.line && o.calleeText === e.calleeText) === index,
        );
        if (calls.length > MAX_CALLS_PER_NODE) truncated = true;

        const targets = calls
          .map((c) => c.toSymbolId)
          .filter((id): id is string => id !== null && !seen.has(id));
        const symbols = new Map(
          (
            await prisma.symbol.findMany({
              where: { id: { in: [...new Set(targets)] } },
              include: { file: { select: { path: true } } },
            })
          ).map((s) => [s.id, s]),
        );

        node.calls = calls.slice(0, MAX_CALLS_PER_NODE).map((call) => {
          const target = call.toSymbolId;
          if (!target)
            return { callee: call.calleeText, line: call.line, resolved: false, target: null };
          const symbol = symbols.get(target);
          if (symbol && !seen.has(target) && node.depth < MAX_DEPTH) {
            if (nodes.length >= MAX_NODES) {
              truncated = true;
            } else {
              seen.add(target);
              nodes.push({
                id: symbol.id,
                parentId: node.id,
                depth: node.depth + 1,
                label: symbol.qualifiedName,
                kind: symbol.kind.toLowerCase(),
                path: symbol.file.path,
                fileId: symbol.fileId,
                startLine: symbol.startLine,
                endLine: symbol.endLine,
                calls: [],
              });
            }
          }
          return {
            callee: call.calleeText,
            line: call.line,
            resolved: call.resolved,
            target: seen.has(target) ? target : null,
          };
        });
      }

      /** Points a class node at its constructor's lines; false when it has none. */
      async function narrowToConstructor(
        node: Span & { label: string; kind: string },
      ): Promise<boolean> {
        const constructor = await prisma.symbol.findFirst({
          where: { fileId: node.fileId, qualifiedName: `${node.label}.constructor` },
          select: { startLine: true, endLine: true },
        });
        if (!constructor) return false;
        node.kind = 'constructor';
        node.startLine = constructor.startLine;
        node.endLine = constructor.endLine;
        return true;
      }

      return {
        route: {
          id: route.id,
          method: route.method,
          path: route.path,
          file: route.file.path,
          startLine: route.startLine,
        },
        nodes: nodes.map(({ fileId: _fileId, ...node }) => node),
        maxDepth: MAX_DEPTH,
        truncated,
      };
    },
  };
}

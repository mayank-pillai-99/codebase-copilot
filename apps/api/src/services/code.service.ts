import type { FileEntry, FileResponse } from '@codebase-copilot/shared';
import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';
import { findVisibleSnapshot, type DemoRepositories } from './snapshot-access';

export interface CodeService {
  /** viewerId is null for anonymous visitors (demo repositories only). */
  listFiles(viewerId: string | null, snapshotId: string): Promise<FileEntry[]>;
  getFile(viewerId: string | null, snapshotId: string, path: string): Promise<FileResponse>;
}

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
  };
}

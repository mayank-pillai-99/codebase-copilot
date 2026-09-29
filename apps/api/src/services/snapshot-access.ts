import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const snapshotInclude = {
  repository: { select: { id: true, owner: true, name: true } },
} as const;

/**
 * The single access rule for snapshot data: a snapshot is visible to users who
 * track its repository. Everyone else gets 404, so ids can't be probed.
 */
export async function findVisibleSnapshot(
  prisma: PrismaClient,
  userId: string,
  snapshotId: string,
) {
  if (!UUID.test(snapshotId)) throw new AppError(404, 'Not found');
  const snapshot = await prisma.snapshot.findFirst({
    where: { id: snapshotId, repository: { trackedBy: { some: { userId } } } },
    include: snapshotInclude,
  });
  if (!snapshot) throw new AppError(404, 'Not found');
  return snapshot;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

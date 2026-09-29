import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const snapshotInclude = {
  repository: { select: { id: true, owner: true, name: true } },
} as const;

/** "owner/name" pairs that anyone may view without an account (DEMO_REPOSITORIES). */
export type DemoRepositories = readonly { owner: string; name: string }[];

export function parseDemoRepositories(value: string | undefined): DemoRepositories {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().split('/'))
    .filter(
      (parts): parts is [string, string] => parts.length === 2 && Boolean(parts[0] && parts[1]),
    )
    .map(([owner, name]) => ({ owner, name }));
}

/** Prisma filter matching repositories in the demo list (GitHub names are case-insensitive). */
export function demoRepositoryFilter(demo: DemoRepositories) {
  return demo.map(({ owner, name }) => ({
    owner: { equals: owner, mode: 'insensitive' as const },
    name: { equals: name, mode: 'insensitive' as const },
  }));
}

/**
 * The single access rule for snapshot data: visible to users who track the
 * repository, and to everyone (signed in or not) for demo repositories. Everyone
 * else gets 404, so ids can't be probed.
 */
export async function findVisibleSnapshot(
  prisma: PrismaClient,
  viewerId: string | null,
  snapshotId: string,
  demo: DemoRepositories = [],
) {
  if (!UUID.test(snapshotId)) throw new AppError(404, 'Not found');
  const visibleVia = [
    ...(viewerId ? [{ repository: { trackedBy: { some: { userId: viewerId } } } }] : []),
    ...(demo.length ? [{ repository: { OR: demoRepositoryFilter(demo) } }] : []),
  ];
  if (visibleVia.length === 0) throw new AppError(404, 'Not found');
  const snapshot = await prisma.snapshot.findFirst({
    where: { id: snapshotId, OR: visibleVia },
    include: snapshotInclude,
  });
  if (!snapshot) throw new AppError(404, 'Not found');
  return snapshot;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

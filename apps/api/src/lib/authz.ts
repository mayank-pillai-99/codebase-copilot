import { AppError } from './errors';

/**
 * Ownership check for user-owned resources (snapshots, chat sessions, …).
 * Responds 404 rather than 403 so other users can't probe which ids exist.
 */
export function assertOwnedBy<T extends { userId: string | null }>(
  resource: T | null | undefined,
  userId: string,
): asserts resource is T {
  if (!resource || resource.userId !== userId) {
    throw new AppError(404, 'Not found');
  }
}

import { describe, expect, it } from 'vitest';
import { assertOwnedBy } from '../src/lib/authz';
import { AppError } from '../src/lib/errors';

describe('assertOwnedBy', () => {
  it('passes for the owner', () => {
    expect(() => assertOwnedBy({ userId: 'u1' }, 'u1')).not.toThrow();
  });

  it('answers 404 (not 403) for another user or a missing resource', () => {
    const notFound = new AppError(404, 'Not found');
    expect(() => assertOwnedBy({ userId: 'u1' }, 'u2')).toThrow(notFound);
    expect(() => assertOwnedBy({ userId: null }, 'u2')).toThrow(notFound);
    expect(() => assertOwnedBy(null, 'u1')).toThrow(notFound);
  });
});

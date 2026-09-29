import { randomUUID } from 'node:crypto';
import type { PasswordHasher } from '../../src/lib/password';
import {
  EmailTakenError,
  type UserRecord,
  type UserRepository,
} from '../../src/repositories/user.repository';

/** In-memory stand-in for the Postgres-backed repository. */
export function createInMemoryUsers(): UserRepository & { all(): UserRecord[] } {
  const byId = new Map<string, UserRecord>();
  return {
    all: () => [...byId.values()],
    findById: async (id) => byId.get(id) ?? null,
    findByEmail: async (email) => [...byId.values()].find((u) => u.email === email) ?? null,
    async create({ email, passwordHash }) {
      if ([...byId.values()].some((u) => u.email === email)) throw new EmailTakenError();
      const user = { id: randomUUID(), email, passwordHash, createdAt: new Date() };
      byId.set(user.id, user);
      return user;
    },
  };
}

/** Fast, obviously-not-secure hasher so unit tests don't pay Argon2's cost. */
export const fakeHasher: PasswordHasher = {
  hash: async (password) => `hashed:${password}`,
  verify: async (passwordHash, password) => passwordHash === `hashed:${password}`,
};

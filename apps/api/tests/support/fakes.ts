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

/**
 * Deterministic stand-in for an embedding model: words are hashed into buckets
 * (feature hashing), so texts sharing identifiers get similar vectors. Good enough
 * to exercise storage and retrieval without network calls.
 */
export function hashingEmbedder(model = 'test-hashing-768') {
  const embed = (text: string) => {
    const vector = new Array<number>(768).fill(0);
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let h = 2166136261;
      for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      vector[Math.abs(h) % 768]! += 1;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((v) => v / norm);
  };
  return {
    model,
    embedDocuments: async (texts: string[]) => texts.map(embed),
    embedQuery: async (text: string) => embed(text),
  };
}

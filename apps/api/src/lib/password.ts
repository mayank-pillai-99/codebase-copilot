import { hash, verify } from '@node-rs/argon2';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

/**
 * Argon2id with the library defaults (19 MiB memory, 2 iterations, 1 lane),
 * which match OWASP's minimum recommendation. The parameters are encoded in each
 * hash, so raising them later doesn't invalidate existing passwords.
 */
export const argon2Hasher: PasswordHasher = {
  hash: (password) => hash(password),
  async verify(passwordHash, password) {
    try {
      return await verify(passwordHash, password);
    } catch {
      // A malformed stored hash is treated as a failed match, not a server error.
      return false;
    }
  },
};

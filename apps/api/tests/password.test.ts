import { describe, expect, it } from 'vitest';
import { argon2Hasher } from '../src/lib/password';

describe('argon2 password hasher', () => {
  it('produces an argon2id hash that verifies only the original password', async () => {
    const hash = await argon2Hasher.hash('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct horse');
    await expect(argon2Hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(argon2Hasher.verify(hash, 'Correct horse battery staple')).resolves.toBe(false);
  });

  it('salts each hash', async () => {
    const [a, b] = await Promise.all([argon2Hasher.hash('same'), argon2Hasher.hash('same')]);
    expect(a).not.toBe(b);
  });

  it('treats a malformed stored hash as a mismatch', async () => {
    await expect(argon2Hasher.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors';
import { createAuthService, INVALID_CREDENTIALS } from '../src/services/auth.service';
import { createInMemoryUsers, fakeHasher } from './support/fakes';

function setup() {
  const users = createInMemoryUsers();
  return { users, auth: createAuthService({ users, hasher: fakeHasher }) };
}

describe('auth service', () => {
  it('registers a user and never exposes the password hash', async () => {
    const { auth, users } = setup();
    const user = await auth.register({ email: 'ada@example.com', password: 'correct horse' });

    expect(user).toEqual({
      id: expect.any(String),
      email: 'ada@example.com',
      createdAt: expect.any(String),
    });
    expect(user).not.toHaveProperty('passwordHash');
    expect(users.all()[0]?.passwordHash).toBe('hashed:correct horse');
  });

  it('rejects a duplicate email with 409', async () => {
    const { auth } = setup();
    await auth.register({ email: 'ada@example.com', password: 'correct horse' });

    await expect(
      auth.register({ email: 'ada@example.com', password: 'another one' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('logs in with the right password', async () => {
    const { auth } = setup();
    const registered = await auth.register({ email: 'ada@example.com', password: 'correct horse' });

    await expect(
      auth.login({ email: 'ada@example.com', password: 'correct horse' }),
    ).resolves.toEqual(registered);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { auth } = setup();
    await auth.register({ email: 'ada@example.com', password: 'correct horse' });

    const wrongPassword = auth.login({ email: 'ada@example.com', password: 'nope' });
    const unknownEmail = auth.login({ email: 'grace@example.com', password: 'nope' });

    await expect(wrongPassword).rejects.toEqual(new AppError(401, INVALID_CREDENTIALS));
    await expect(unknownEmail).rejects.toEqual(new AppError(401, INVALID_CREDENTIALS));
  });

  it('still runs password verification when the email is unknown', async () => {
    const users = createInMemoryUsers();
    const verify = vi.fn(fakeHasher.verify);
    const auth = createAuthService({ users, hasher: { ...fakeHasher, verify } });

    await expect(auth.login({ email: 'nobody@example.com', password: 'x' })).rejects.toThrow();
    expect(verify).toHaveBeenCalledOnce();
  });

  it('returns null for an unknown user id', async () => {
    const { auth } = setup();
    await expect(auth.getUser('00000000-0000-4000-8000-000000000000')).resolves.toBeNull();
  });
});

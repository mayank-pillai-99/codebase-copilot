import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '../src/lib/prisma';
import { createUserRepository, EmailTakenError } from '../src/repositories/user.repository';

const { DATABASE_URL, RUN_INTEGRATION } = process.env;

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('user repository (integration)', () => {
  const prisma = createPrisma(DATABASE_URL!);
  const users = createUserRepository(prisma);
  const email = `repo-test-${randomUUID()}@example.test`;

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it('creates and finds a user by email and id', async () => {
    const created = await users.create({ email, passwordHash: 'hash' });
    expect(await users.findByEmail(email)).toMatchObject({ id: created.id, email });
    expect(await users.findById(created.id)).toMatchObject({ email });
  });

  it('maps the unique-constraint violation to EmailTakenError', async () => {
    await expect(users.create({ email, passwordHash: 'other' })).rejects.toBeInstanceOf(
      EmailTakenError,
    );
  });

  it('returns null for unknown users', async () => {
    expect(await users.findById(randomUUID())).toBeNull();
    expect(await users.findByEmail(`missing-${randomUUID()}@example.test`)).toBeNull();
  });
});

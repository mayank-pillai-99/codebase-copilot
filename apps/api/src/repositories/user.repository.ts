import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../lib/prisma';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export class EmailTakenError extends Error {
  constructor() {
    super('Email is already registered');
    this.name = 'EmailTakenError';
  }
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  /** Throws EmailTakenError when the email already exists. */
  create(data: { email: string; passwordHash: string }): Promise<UserRecord>;
}

const UNIQUE_VIOLATION = 'P2002';

export function createUserRepository(prisma: PrismaClient): UserRepository {
  return {
    findById: (id) => prisma.user.findUnique({ where: { id } }),
    findByEmail: (email) => prisma.user.findUnique({ where: { email } }),
    async create(data) {
      try {
        return await prisma.user.create({ data });
      } catch (err) {
        // The unique index is the source of truth; checking first would race.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
          throw new EmailTakenError();
        }
        throw err;
      }
    },
  };
}

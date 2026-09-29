import type { LoginRequest, PublicUser, RegisterRequest } from '@codebase-copilot/shared';
import { AppError } from '../lib/errors';
import type { PasswordHasher } from '../lib/password';
import {
  EmailTakenError,
  type UserRecord,
  type UserRepository,
} from '../repositories/user.repository';

export interface AuthService {
  register(input: RegisterRequest): Promise<PublicUser>;
  login(input: LoginRequest): Promise<PublicUser>;
  getUser(id: string): Promise<PublicUser | null>;
}

export const INVALID_CREDENTIALS = 'Invalid email or password';

export function createAuthService(deps: {
  users: UserRepository;
  hasher: PasswordHasher;
}): AuthService {
  const { users, hasher } = deps;
  let dummyHash: Promise<string> | undefined;

  return {
    async register({ email, password }) {
      const passwordHash = await hasher.hash(password);
      try {
        return toPublicUser(await users.create({ email, passwordHash }));
      } catch (err) {
        if (err instanceof EmailTakenError) {
          throw new AppError(409, 'An account with this email already exists');
        }
        throw err;
      }
    },

    async login({ email, password }) {
      const user = await users.findByEmail(email);
      // Verify against a throwaway hash when the user doesn't exist, so response
      // time doesn't reveal which emails are registered.
      dummyHash ??= hasher.hash('timing-equalization-placeholder');
      const valid = await hasher.verify(user?.passwordHash ?? (await dummyHash), password);
      if (!user || !valid) throw new AppError(401, INVALID_CREDENTIALS);
      return toPublicUser(user);
    },

    async getUser(id) {
      const user = await users.findById(id);
      return user ? toPublicUser(user) : null;
    },
  };
}

function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}

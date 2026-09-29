import { SESSION_COOKIE } from '@codebase-copilot/shared';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors';

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler that rejects requests without a valid session with 401. */
    authenticate: (request: FastifyRequest) => Promise<void>;
    /** preHandler that reads a session if present; anonymous requests continue. */
    identify: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyReply {
    /**
     * Resolves to void on purpose: a reply is thenable, so resolving to the reply
     * would wait for the response to finish and deadlock the handler.
     */
    startSession: (userId: string) => Promise<void>;
    endSession: () => FastifyReply;
  }
}

export interface AuthPluginOptions {
  jwtSecret: string;
  /** Secure cookies need HTTPS; off for local HTTP development. */
  secureCookies: boolean;
}

/**
 * Stateless sessions: a signed JWT (subject = user id) in an httpOnly cookie.
 * SameSite=Lax keeps the cookie off cross-site POSTs, which is the CSRF defense
 * together with JSON-only request bodies.
 */
export const authPlugin = fp<AuthPluginOptions>(async (app, opts) => {
  await app.register(cookie);
  await app.register(jwt, {
    secret: opts.jwtSecret,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    sign: { expiresIn: SESSION_TTL_SECONDS },
  });

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secureCookies,
    path: '/',
  } as const;

  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(401, 'Please sign in to continue');
    }
  });

  app.decorate('identify', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      // Anonymous: routes using this hook decide what anonymous visitors may see.
    }
  });

  app.decorateReply('startSession', async function (this: FastifyReply, userId: string) {
    const token = await this.jwtSign({ sub: userId });
    this.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_SECONDS });
  });

  app.decorateReply('endSession', function (this: FastifyReply) {
    return this.clearCookie(SESSION_COOKIE, cookieOptions);
  });
});

/** The signed-in user's id after `identify`, or null for anonymous visitors. */
export function viewerId(request: FastifyRequest): string | null {
  const user = request.user as { sub?: string } | undefined;
  return user?.sub ?? null;
}

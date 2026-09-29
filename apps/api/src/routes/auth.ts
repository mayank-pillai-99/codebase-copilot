import { loginRequestSchema, registerRequestSchema } from '@codebase-copilot/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AuthService } from '../services/auth.service';

export interface AuthRouteOptions {
  auth: AuthService;
}

// Per IP, on endpoints that check passwords or create accounts.
const credentialRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { auth }) => {
  app.post('/api/auth/register', { config: credentialRateLimit }, async (request, reply) => {
    const user = await auth.register(registerRequestSchema.parse(request.body));
    await reply.startSession(user.id);
    return reply.code(201).send({ user });
  });

  app.post('/api/auth/login', { config: credentialRateLimit }, async (request, reply) => {
    const user = await auth.login(loginRequestSchema.parse(request.body));
    await reply.startSession(user.id);
    return reply.send({ user });
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    return reply.endSession().code(204).send();
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const user = await auth.getUser(request.user.sub);
    if (!user) {
      // Valid token for a deleted account: drop the stale cookie.
      return reply.endSession().code(401).send({ error: 'Please sign in to continue' });
    }
    return reply.send({ user });
  });
};

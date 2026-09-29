import { addRepositoryRequestSchema } from '@codebase-copilot/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { RepositoryService } from '../services/repository.service';

export interface RepositoryRouteOptions {
  repositories: RepositoryService;
}

type SnapshotParams = { Params: { id: string } };

export const repositoryRoutes: FastifyPluginAsync<RepositoryRouteOptions> = async (
  app,
  { repositories },
) => {
  app.addHook('preHandler', app.authenticate);

  // Each submission can cost several GitHub API calls and an indexing job.
  app.post(
    '/api/repos',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const { url } = addRepositoryRequestSchema.parse(request.body);
      const snapshot = await repositories.addRepository(request.user.sub, url);
      return reply.code(snapshot.status === 'READY' ? 200 : 202).send({ snapshot });
    },
  );

  app.get('/api/repos', async (request) => ({
    repositories: await repositories.listRepositories(request.user.sub),
  }));

  app.get<SnapshotParams>('/api/snapshots/:id', async (request) => ({
    snapshot: await repositories.getSnapshot(request.user.sub, request.params.id),
  }));

  app.get<SnapshotParams>('/api/snapshots/:id/routes', async (request) => ({
    routes: await repositories.listRoutes(request.user.sub, request.params.id),
  }));
};

import { addRepositoryRequestSchema } from '@codebase-copilot/shared';
import type { FastifyPluginAsync } from 'fastify';
import { viewerId } from '../plugins/auth';
import type { RepositoryService } from '../services/repository.service';

export interface RepositoryRouteOptions {
  repositories: RepositoryService;
}

type SnapshotParams = { Params: { id: string } };

export const repositoryRoutes: FastifyPluginAsync<RepositoryRouteOptions> = async (
  app,
  { repositories },
) => {
  // Each submission can cost several GitHub API calls and an indexing job.
  app.post(
    '/api/repos',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const { url } = addRepositoryRequestSchema.parse(request.body);
      const snapshot = await repositories.addRepository(request.user.sub, url);
      return reply.code(snapshot.status === 'READY' ? 200 : 202).send({ snapshot });
    },
  );

  app.get('/api/repos', { preHandler: app.authenticate }, async (request) => ({
    repositories: await repositories.listRepositories(request.user.sub),
  }));

  // Public: demo repositories anyone can explore without an account.
  app.get('/api/demo', async () => ({ repositories: await repositories.listDemo() }));

  // Snapshot data is readable anonymously for demo repositories.
  app.get<SnapshotParams>('/api/snapshots/:id', { preHandler: app.identify }, async (request) => ({
    snapshot: await repositories.getSnapshot(viewerId(request), request.params.id),
  }));

  app.get<SnapshotParams>(
    '/api/snapshots/:id/routes',
    { preHandler: app.identify },
    async (request) => ({
      routes: await repositories.listRoutes(viewerId(request), request.params.id),
    }),
  );
};

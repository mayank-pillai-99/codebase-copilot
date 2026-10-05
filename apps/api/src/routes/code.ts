import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { rateLimitKey, viewerId } from '../plugins/auth';
import type { CodeService } from '../services/code.service';

export interface CodeRouteOptions {
  code: CodeService;
}

const fileQuery = z.object({ path: z.string().min(1).max(1_000) });
const referencesQuery = fileQuery.extend({ line: z.coerce.number().int().min(1) });

export const codeRoutes: FastifyPluginAsync<CodeRouteOptions> = async (app, { code }) => {
  // Readable anonymously for demo repositories.
  app.addHook('preHandler', app.identify);

  app.get<{ Params: { id: string } }>('/api/snapshots/:id/files', async (request) => ({
    files: await code.listFiles(viewerId(request), request.params.id),
  }));

  // The path is a query parameter (not a route segment) so it can contain slashes.
  app.get<{ Params: { id: string } }>('/api/snapshots/:id/file', async (request) => {
    const { path } = fileQuery.parse(request.query);
    return code.getFile(viewerId(request), request.params.id, path);
  });

  app.get<{ Params: { id: string } }>('/api/snapshots/:id/references', async (request) => {
    const { path, line } = referencesQuery.parse(request.query);
    return code.getReferences(viewerId(request), request.params.id, path, line);
  });

  // Each request loads the snapshot's whole call graph, so it's limited more tightly.
  app.get<{ Params: { id: string } }>(
    '/api/snapshots/:id/impact',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: rateLimitKey } } },
    async (request) => {
      const { path, line } = referencesQuery.parse(request.query);
      return code.getImpact(viewerId(request), request.params.id, path, line);
    },
  );
};

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { viewerId } from '../plugins/auth';
import type { CodeService } from '../services/code.service';

export interface CodeRouteOptions {
  code: CodeService;
}

const fileQuery = z.object({ path: z.string().min(1).max(1_000) });

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
};

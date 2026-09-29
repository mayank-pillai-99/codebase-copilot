import { searchRequestSchema } from '@codebase-copilot/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { rateLimitKey, viewerId } from '../plugins/auth';
import type { SearchService } from '../services/search.service';

export interface SearchRouteOptions {
  search: SearchService;
}

/** Vector and hybrid searches each cost one embedding request. */
async function maxPerMinute(request: FastifyRequest): Promise<number> {
  return (await rateLimitKey(request)).startsWith('user:') ? 30 : 10;
}

export const searchRoutes: FastifyPluginAsync<SearchRouteOptions> = async (app, { search }) => {
  // Anonymous visitors may search demo repositories; the service enforces which.
  app.addHook('preHandler', app.identify);

  app.post<{ Params: { id: string } }>(
    '/api/snapshots/:id/search',
    {
      config: {
        rateLimit: { max: maxPerMinute, timeWindow: '1 minute', keyGenerator: rateLimitKey },
      },
    },
    async (request) =>
      search.search(
        viewerId(request),
        request.params.id,
        searchRequestSchema.parse(request.body ?? {}),
      ),
  );
};

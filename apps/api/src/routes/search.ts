import { searchRequestSchema } from '@codebase-copilot/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { rateLimitKey, viewerId } from '../plugins/auth';
import type { SearchService } from '../services/search.service';

export interface SearchRouteOptions {
  search: SearchService;
}

/**
 * Full-text search is cheap and runs as people type; vector and hybrid searches each
 * cost one embedding request from a shared daily quota, so they get tighter limits.
 */
async function maxPerMinute(request: FastifyRequest): Promise<number> {
  const user = (await rateLimitKey(request)).startsWith('user:');
  const retriever = (request.body as { retriever?: unknown } | undefined)?.retriever;
  if (retriever === 'fulltext') return user ? 60 : 40;
  return user ? 30 : 10;
}

export const searchRoutes: FastifyPluginAsync<SearchRouteOptions> = async (app, { search }) => {
  // Anonymous visitors may search demo repositories; the service enforces which.
  app.addHook('preHandler', app.identify);

  app.post<{ Params: { id: string } }>(
    '/api/snapshots/:id/search',
    {
      config: {
        rateLimit: {
          max: maxPerMinute,
          timeWindow: '1 minute',
          keyGenerator: rateLimitKey,
          // After body parsing, so the limit can depend on the retriever.
          hook: 'preHandler',
        },
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

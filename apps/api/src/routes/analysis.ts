import type { FastifyPluginAsync } from 'fastify';
import { rateLimitKey, viewerId } from '../plugins/auth';
import type { ArchitectureService } from '../services/architecture.service';
import type { GuideService } from '../services/guide.service';
import type { TraceService } from '../services/trace.service';

export interface AnalysisRouteOptions {
  architecture: ArchitectureService;
  trace: TraceService;
  guide: GuideService;
}

/** Analyses of a snapshot: the architecture map, request traces and the onboarding guide. */
export const analysisRoutes: FastifyPluginAsync<AnalysisRouteOptions> = async (
  app,
  { architecture, trace, guide },
) => {
  // Readable anonymously for demo repositories.
  app.addHook('preHandler', app.identify);

  app.get<{ Params: { id: string } }>('/api/snapshots/:id/architecture', async (request) => ({
    architecture: await architecture.getArchitecture(viewerId(request), request.params.id),
  }));

  app.get<{ Params: { id: string; routeId: string } }>(
    '/api/snapshots/:id/routes/:routeId/trace',
    async (request) => trace.trace(viewerId(request), request.params.id, request.params.routeId),
  );

  app.get<{ Params: { id: string } }>('/api/snapshots/:id/guide', async (request) => ({
    guide: await guide.getGuide(viewerId(request), request.params.id),
  }));

  // The one AI call in the guide; cached per snapshot, so the limit only guards misuse.
  app.get<{ Params: { id: string } }>(
    '/api/snapshots/:id/guide/summary',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: rateLimitKey } } },
    async (request) => guide.getSummary(viewerId(request), request.params.id),
  );
};

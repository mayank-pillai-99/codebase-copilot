import type { FastifyPluginAsync } from 'fastify';
import { viewerId } from '../plugins/auth';
import type { ArchitectureService } from '../services/architecture.service';
import type { TraceService } from '../services/trace.service';

export interface AnalysisRouteOptions {
  architecture: ArchitectureService;
  trace: TraceService;
}

/** Deterministic analyses of a snapshot: the architecture map and request traces. */
export const analysisRoutes: FastifyPluginAsync<AnalysisRouteOptions> = async (
  app,
  { architecture, trace },
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
};

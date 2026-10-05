import type { EvalLatestResponse } from '@codebase-copilot/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { EvalService } from '../services/eval.service';

export interface EvalRouteOptions {
  evals: EvalService;
}

/** Public: the latest evaluation run, for the /eval page (not linked from the UI). */
export const evalRoutes: FastifyPluginAsync<EvalRouteOptions> = async (app, { evals }) => {
  app.get('/api/eval/latest', async (_request, reply): Promise<EvalLatestResponse> => {
    // Results change only when a new run is imported at startup.
    reply.header('cache-control', 'public, max-age=300');
    return { run: await evals.latest() };
  });
};

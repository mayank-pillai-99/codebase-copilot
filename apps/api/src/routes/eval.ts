import type { EvalLatestResponse } from '@codebase-copilot/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { EvalService } from '../services/eval.service';

export interface EvalRouteOptions {
  evals: EvalService;
}

/** Public: evaluation results are published on /eval. */
export const evalRoutes: FastifyPluginAsync<EvalRouteOptions> = async (app, { evals }) => {
  app.get('/api/eval/latest', async (_request, reply): Promise<EvalLatestResponse> => {
    // Results change only when a new run is imported at startup.
    reply.header('cache-control', 'public, max-age=300');
    return { run: await evals.latest() };
  });
};

import 'server-only';

/** Server-side base URL of the Fastify API. Browser code calls relative `/api/*` paths instead. */
export const API_URL = process.env.API_URL ?? 'http://localhost:4000';

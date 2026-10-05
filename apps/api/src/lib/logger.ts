import type { FastifyServerOptions } from 'fastify';
import type { Env } from '../config/env';

/** Pino options for the API. Never log credentials. */
export function loggerOptions(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-proxy-secret"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[redacted]',
    },
    ...(env.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      },
    }),
  };
}

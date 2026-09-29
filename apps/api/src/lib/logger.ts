import type { FastifyServerOptions } from 'fastify';
import type { Env } from '../config/env';

/** Pino options shared by the API (and later the worker). Never log credentials. */
export function loggerOptions(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
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

import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from '../src/config/env';

const valid = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/codebase_copilot',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('applies defaults for optional settings', () => {
    const env = parseEnv(valid);
    expect(env).toMatchObject({ NODE_ENV: 'development', PORT: 4000, LOG_LEVEL: 'info' });
  });

  it('coerces PORT from a string', () => {
    expect(parseEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a missing DATABASE_URL with a readable message', () => {
    expect(() => parseEnv({ REDIS_URL: valid.REDIS_URL })).toThrow(EnvError);
    expect(() => parseEnv({ REDIS_URL: valid.REDIS_URL })).toThrow(/DATABASE_URL/);
  });

  it('rejects URLs with the wrong protocol', () => {
    expect(() => parseEnv({ ...valid, REDIS_URL: 'http://localhost:6379' })).toThrow(/REDIS_URL/);
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('accepts TLS Redis URLs used by hosted providers', () => {
    expect(
      parseEnv({ ...valid, REDIS_URL: 'rediss://default:pw@example.upstash.io:6379' }).REDIS_URL,
    ).toMatch(/^rediss:/);
  });
});

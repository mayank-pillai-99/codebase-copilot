import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from '../src/config/env';

const valid = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/codebase_copilot',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a-secret-that-is-at-least-32-characters',
};

describe('auth settings', () => {
  it('requires a JWT secret of at least 32 characters', () => {
    const { JWT_SECRET: _omitted, ...withoutSecret } = valid;
    expect(() => parseEnv(withoutSecret)).toThrow(/JWT_SECRET/);
    expect(() => parseEnv({ ...valid, JWT_SECRET: 'too-short' })).toThrow(
      /JWT_SECRET: must be at least 32 characters/,
    );
  });

  it('parses TRUST_PROXY as a boolean and defaults it to false', () => {
    expect(parseEnv(valid).TRUST_PROXY).toBe(false);
    expect(parseEnv({ ...valid, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(() => parseEnv({ ...valid, TRUST_PROXY: 'maybe' })).toThrow(/TRUST_PROXY/);
  });
});

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

describe('indexing settings', () => {
  it('defaults the limits and keeps the worker out of the API process', () => {
    expect(parseEnv(valid)).toMatchObject({
      RUN_WORKER_IN_PROCESS: false,
      MAX_ARCHIVE_MB: 50,
      MAX_SOURCE_FILES: 2000,
      MAX_FILE_KB: 200,
      MAX_TOTAL_SOURCE_MB: 30,
    });
  });

  it('turns AI features off when GEMINI_API_KEY is empty', () => {
    expect(parseEnv({ ...valid, GEMINI_API_KEY: '' }).GEMINI_API_KEY).toBeUndefined();
    expect(parseEnv(valid).EMBEDDING_MODEL).toBe('gemini-embedding-2');
  });

  it('treats an empty GITHUB_TOKEN as no token', () => {
    expect(parseEnv({ ...valid, GITHUB_TOKEN: '' }).GITHUB_TOKEN).toBeUndefined();
    expect(parseEnv({ ...valid, GITHUB_TOKEN: 'ghp_x' }).GITHUB_TOKEN).toBe('ghp_x');
  });
});

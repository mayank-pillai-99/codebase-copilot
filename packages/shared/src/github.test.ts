import { describe, expect, it } from 'vitest';
import { addRepositoryRequestSchema, parseGitHubUrl } from './github';

describe('parseGitHubUrl', () => {
  it.each([
    ['https://github.com/expressjs/express', { owner: 'expressjs', repo: 'express' }],
    ['https://github.com/expressjs/express/', { owner: 'expressjs', repo: 'express' }],
    ['https://github.com/expressjs/express.git', { owner: 'expressjs', repo: 'express' }],
    ['http://www.github.com/expressjs/express', { owner: 'expressjs', repo: 'express' }],
    ['github.com/colinhacks/zod', { owner: 'colinhacks', repo: 'zod' }],
    ['colinhacks/zod', { owner: 'colinhacks', repo: 'zod' }],
    ['  https://github.com/vercel/next.js  ', { owner: 'vercel', repo: 'next.js' }],
    ['https://github.com/o/r?tab=readme#top', { owner: 'o', repo: 'r' }],
  ])('parses %s', (input, expected) => {
    expect(parseGitHubUrl(input)).toEqual(expected);
  });

  it('reads the ref from /tree and /commit URLs, including branch names with slashes', () => {
    expect(parseGitHubUrl('https://github.com/o/r/tree/feature/login-page')).toEqual({
      owner: 'o',
      repo: 'r',
      ref: 'feature/login-page',
    });
    expect(parseGitHubUrl('https://github.com/o/r/commit/abc123')).toEqual({
      owner: 'o',
      repo: 'r',
      ref: 'abc123',
    });
  });

  it.each([
    ['another host', 'https://gitlab.com/o/r'],
    ['lookalike host', 'https://github.com.evil.com/o/r'],
    ['credentials in URL', 'https://user:pw@github.com/o/r'],
    ['custom port', 'https://github.com:8443/o/r'],
    ['non-http scheme', 'ftp://github.com/o/r'],
    ['missing repo', 'https://github.com/owner'],
    ['issues page', 'https://github.com/o/r/issues/1'],
    ['tree without ref', 'https://github.com/o/r/tree'],
    ['invalid owner', 'https://github.com/-bad/r'],
    ['dot-dot repo', 'https://github.com/o/..'],
    ['empty', '   '],
  ])('rejects %s', (_label, input) => {
    expect(parseGitHubUrl(input)).toBeNull();
  });
});

describe('addRepositoryRequestSchema', () => {
  it('explains what a valid URL looks like', () => {
    const result = addRepositoryRequestSchema.safeParse({ url: 'https://gitlab.com/o/r' });
    expect(result.error?.issues[0]?.message).toMatch(/github\.com\/owner\/repo/);
  });
});

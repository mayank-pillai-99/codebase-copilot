import { describe, expect, it } from 'vitest';
import {
  codeHref,
  describeSkipped,
  githubBlobUrl,
  isSupportingPath,
  parseLineRange,
  percent,
  shortSha,
} from './format';

describe('format helpers', () => {
  it('builds GitHub links pinned to the commit, with line anchors', () => {
    const repo = { owner: 'expressjs', name: 'express' };
    const sha = 'a'.repeat(40);
    expect(githubBlobUrl(repo, sha, 'lib/router/index.js', 10, 20)).toBe(
      `https://github.com/expressjs/express/blob/${sha}/lib/router/index.js#L10-L20`,
    );
    expect(githubBlobUrl(repo, sha, 'lib/a b.js', 5, 5)).toMatch(/lib\/a%20b\.js#L5$/);
    expect(githubBlobUrl(repo, sha, 'README.md')).toMatch(/README\.md$/);
  });

  it('formats percentages and short SHAs', () => {
    expect(percent(1, 3)).toBe('33%');
    expect(percent(0, 0)).toBe('—');
    expect(shortSha('0123456789abcdef')).toBe('0123456');
  });

  it('summarizes skipped files, largest first', () => {
    expect(describeSkipped({ lockfile: 1, 'ignored-directory': 1200, binary: 0 })).toBe(
      'Skipped 1,200 dependency or build folders, 1 lockfiles.',
    );
    expect(describeSkipped({})).toBeNull();
  });
});

describe('isSupportingPath', () => {
  it.each([
    'test/app.router.js',
    'src/__tests__/a.ts',
    'packages/x/tests/b.ts',
    'examples/auth/index.js',
    'src/user.spec.ts',
    'lib/a.test.mjs',
  ])('treats %s as tests or examples', (path) => expect(isSupportingPath(path)).toBe(true));

  it.each([
    'lib/router/index.js',
    'src/routes/tests-api.ts',
    'src/contest/route.ts',
    'app/api/test/route.ts',
  ])('treats %s as application code', (path) => expect(isSupportingPath(path)).toBe(false));
});

describe('code viewer links', () => {
  it('builds viewer URLs with a highlighted range and an anchor', () => {
    expect(codeHref('abc', 'src/a b.ts', 10, 20)).toBe(
      '/repos/abc/code?path=src%2Fa+b.ts&lines=10-20#L10',
    );
    expect(codeHref('abc', 'src/a.ts', 5, 5)).toBe('/repos/abc/code?path=src%2Fa.ts&lines=5#L5');
    expect(codeHref('abc', 'README.md')).toBe('/repos/abc/code?path=README.md');
  });

  it('parses line ranges defensively', () => {
    expect(parseLineRange('10-20')).toEqual({ start: 10, end: 20 });
    expect(parseLineRange('7')).toEqual({ start: 7, end: 7 });
    for (const bad of ['20-10', '0', 'x', '1-2-3', undefined, ['1']]) {
      expect(parseLineRange(bad)).toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { matchFiles } from './search';

const files = [
  'src/app/routes/auth/auth.service.ts',
  'src/app/routes/auth/auth.controller.ts',
  'src/app/routes/article/article.service.ts',
  'src/app/models/http-exception.model.ts',
  'src/prisma/seed.ts',
  'README.md',
].map((path) => ({ path }));

const paths = (query: string, limit?: number) => matchFiles(files, query, limit).map((f) => f.path);

describe('matchFiles', () => {
  it('ranks file-name matches first', () => {
    expect(paths('auth.service')[0]).toBe('src/app/routes/auth/auth.service.ts');
    expect(paths('seed')).toEqual(['src/prisma/seed.ts']);
  });

  it('matches characters in order, like an editor', () => {
    expect(paths('authsvc')[0]).toBe('src/app/routes/auth/auth.service.ts');
    expect(paths('httpexc')).toEqual(['src/app/models/http-exception.model.ts']);
  });

  it('does not match long queries scattered across a path', () => {
    // Every letter of "createarticle" appears in order in article.service.ts's path.
    expect(paths('createArticle')).toEqual([]);
  });

  it('is case-insensitive and ignores spaces', () => {
    expect(paths('readme')).toEqual(['README.md']);
    expect(paths('article service')[0]).toBe('src/app/routes/article/article.service.ts');
  });

  it('returns nothing for an empty or unmatched query, and respects the limit', () => {
    expect(paths('  ')).toEqual([]);
    expect(paths('zzz')).toEqual([]);
    expect(paths('s', 2)).toHaveLength(2);
  });
});

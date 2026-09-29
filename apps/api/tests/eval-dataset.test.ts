import { describe, expect, it } from 'vitest';
import { DatasetError, parseDataset } from '../src/eval/dataset';

const manifest = JSON.stringify({
  version: 'v1',
  repos: [{ repo: 'acme/api', sha: 'a'.repeat(40), description: 'Small Express API' }],
});

const question = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'acme-01',
    repo: 'acme/api',
    type: 'locational',
    question: 'Where are passwords hashed?',
    gold: ['src/auth.ts'],
    source: 'human',
    reviewed: true,
    ...overrides,
  });

describe('parseDataset', () => {
  it('parses questions and versions the dataset by content', () => {
    const a = parseDataset(manifest, `${question()}\n\n`);
    expect(a.questions).toHaveLength(1);
    expect(a.repos[0]!.repo).toBe('acme/api');
    expect(a.version).toMatch(/^v1\+[0-9a-f]{8}$/);

    const b = parseDataset(manifest, question({ question: 'Where are passwords checked?' }));
    expect(b.version).not.toBe(a.version);
  });

  it('reports the line of an invalid question', () => {
    const lines = [question(), question({ id: 'acme-02', type: 'trivia' })].join('\n');
    expect(() => parseDataset(manifest, lines)).toThrow(/line 2: type/);
  });

  it.each([
    ['a duplicate id', [question(), question()].join('\n'), /duplicate id/],
    ['an unknown repo', question({ repo: 'acme/other' }), /not in repos.json/],
    ['a duplicate gold path', question({ gold: ['a.ts', 'a.ts'] }), /duplicate gold/],
    ['broken JSON', '{"id":', /not valid JSON/],
    ['no questions', '\n', /no questions/],
  ])('rejects %s', (_label, lines, message) => {
    expect(() => parseDataset(manifest, lines)).toThrow(DatasetError);
    expect(() => parseDataset(manifest, lines)).toThrow(message);
  });

  it('requires pinned full SHAs', () => {
    const unpinned = JSON.stringify({
      version: 'v1',
      repos: [{ repo: 'acme/api', sha: 'main', description: 'x' }],
    });
    expect(() => parseDataset(unpinned, question())).toThrow(/full commit SHA/);
  });
});

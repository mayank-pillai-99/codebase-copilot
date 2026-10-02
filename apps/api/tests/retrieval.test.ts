import { describe, expect, it } from 'vitest';
import { queryIdentifiers, toTsQuery } from '../src/retrieval/fulltext';
import { reciprocalRankFusion } from '../src/retrieval/hybrid';
import type { RetrievedChunk } from '../src/retrieval/types';

describe('toTsQuery', () => {
  it('drops stop words, splits identifiers and uses prefix matching', () => {
    expect(toTsQuery('Where do we call createUser?')).toBe(
      'call:* | createuser:* | create:* | user:*',
    );
  });

  it('handles snake_case and constants', () => {
    expect(toTsQuery('MAX_FILE_KB')).toBe('max_file_kb:* | max:* | file:* | kb:*');
  });

  it('never passes tsquery syntax through', () => {
    const query = toTsQuery("auth') | !(x & y:* <-> z");
    expect(query).toBe('auth:*');
  });

  it('returns null when nothing searchable remains', () => {
    expect(toTsQuery('how does it work?')).toBeNull();
    expect(toTsQuery('   ')).toBeNull();
  });
});

describe('queryIdentifiers', () => {
  it('keeps distinct identifiers, lowercased, without stop words', () => {
    expect(queryIdentifiers('Where is createArticle and PaymentService.charge used?')).toEqual([
      'createarticle',
      'paymentservice',
      'charge',
    ]);
    expect(queryIdentifiers('how does it work')).toEqual([]);
  });
});

describe('reciprocalRankFusion', () => {
  const chunk = (id: string, source: 'vector' | 'fulltext'): RetrievedChunk => ({
    chunkId: id,
    fileId: 'f',
    symbolId: null,
    path: 'p',
    kind: 'symbol',
    label: null,
    startLine: 1,
    endLine: 1,
    header: '',
    content: '',
    score: 0,
    sources: [source],
  });

  it('rewards items that rank well in both lists and records their sources', () => {
    const fused = reciprocalRankFusion([
      [chunk('a', 'vector'), chunk('b', 'vector'), chunk('c', 'vector')],
      [chunk('c', 'fulltext'), chunk('a', 'fulltext')],
    ]);
    expect(fused.map((f) => f.id)).toEqual(['a', 'c', 'b']);
    expect(fused[0]).toMatchObject({ sources: ['vector', 'fulltext'] });
    expect(fused[0]!.score).toBeCloseTo(1 / 61 + 1 / 62);
  });
});

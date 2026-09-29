import { describe, expect, it } from 'vitest';
import { checkCitations } from '../src/chat/citations';
import { buildPrompt, formatSources, selectSources, SYSTEM_PROMPT } from '../src/chat/prompt';
import type { RetrievedChunk } from '../src/retrieval/types';

describe('checkCitations', () => {
  it('keeps markers for provided sources in order of first use', () => {
    const result = checkCitations('Auth starts in the controller [2] and uses JWTs [1, 2].', 3);
    expect(result).toEqual({
      valid: [2, 1],
      invalid: [],
      cleaned: 'Auth starts in the controller [2] and uses JWTs [1, 2].',
    });
  });

  it('removes markers for sources the model was never given', () => {
    const result = checkCitations('Payments use Stripe [7]. Refunds are in [1,9] and [0].', 2);
    expect(result.valid).toEqual([1]);
    expect(result.invalid).toEqual([7, 9, 0]);
    expect(result.cleaned).toBe('Payments use Stripe. Refunds are in [1] and.');
  });

  it('ignores bracketed text that is not a citation', () => {
    const result = checkCitations('Use array[i] and [link](url), not [a, b].', 1);
    expect(result).toEqual({
      valid: [],
      invalid: [],
      cleaned: 'Use array[i] and [link](url), not [a, b].',
    });
  });
});

describe('prompt', () => {
  const chunk = (path: string, content: string, label: string | null = null): RetrievedChunk => ({
    chunkId: path,
    fileId: 'f',
    symbolId: null,
    path,
    kind: 'symbol',
    label,
    startLine: 10,
    endLine: 20,
    header: '// header',
    content,
    score: 1,
    sources: ['vector'],
  });

  it('numbers sources with their location and a language fence', () => {
    expect(
      formatSources([chunk('src/auth.ts', 'login()', 'login'), chunk('README.md', '# Hi')]),
    ).toBe(
      '[1] src/auth.ts:10-20 (login)\n```ts\nlogin()\n```\n\n[2] README.md:10-20\n```markdown\n# Hi\n```',
    );
  });

  it('truncates huge sources and stops adding sources past the context budget', () => {
    const big = 'x'.repeat(10_000);
    const selected = selectSources(Array.from({ length: 12 }, (_, i) => chunk(`f${i}.ts`, big)));
    expect(selected.length).toBeLessThan(12);
    expect(formatSources([chunk('a.ts', big)])).toContain('… (truncated)');
  });

  it('puts rules first, history next, and the question with sources last', () => {
    const messages = buildPrompt({
      question: 'How does login work?',
      sources: [chunk('src/auth.ts', 'login()')],
      history: [
        { role: 'user', content: 'What is this repo?' },
        { role: 'assistant', content: 'A payments API.' },
      ],
    });
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[0]!.content).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT).toMatch(/untrusted data/);
    expect(messages[3]!.content).toMatch(/^Sources:\n\n\[1\] src\/auth\.ts/);
    expect(messages[3]!.content).toMatch(/Question: How does login work\?$/);
  });
});

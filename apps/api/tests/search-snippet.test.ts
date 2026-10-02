import { describe, expect, it } from 'vitest';
import { buildSnippet } from '../src/services/search.service';

describe('buildSnippet', () => {
  it('keeps the first non-blank lines without their shared indentation', () => {
    const content =
      '\n    async login(email) {\n\n      const user = await find(email);\n      return user;\n    }\n';
    expect(buildSnippet(content, 3)).toBe(
      'async login(email) {\n  const user = await find(email);\n  return user;',
    );
  });

  it('caps the length with an ellipsis', () => {
    const snippet = buildSnippet('x'.repeat(500), 4, 50);
    expect(snippet).toHaveLength(50);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('handles empty content', () => {
    expect(buildSnippet('\n  \n')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline, parseSseBlock } from './markdown';

describe('parseBlocks', () => {
  it('splits paragraphs, headings, lists and code fences', () => {
    const blocks = parseBlocks(`## Login flow
The controller validates input
and calls the service [1].

- hashes the password
- issues a JWT
  valid for 7 days

1. first
2. second

\`\`\`ts
const token = sign(user);
\`\`\``);
    expect(blocks).toEqual([
      { type: 'heading', text: 'Login flow' },
      { type: 'paragraph', text: 'The controller validates input and calls the service [1].' },
      {
        type: 'list',
        ordered: false,
        items: ['hashes the password', 'issues a JWT valid for 7 days'],
      },
      { type: 'list', ordered: true, items: ['first', 'second'] },
      { type: 'code', language: 'ts', text: 'const token = sign(user);' },
    ]);
  });

  it('treats an unclosed fence as code to the end (while streaming)', () => {
    expect(parseBlocks('Look:\n```js\nfoo();')).toEqual([
      { type: 'paragraph', text: 'Look:' },
      { type: 'code', language: 'js', text: 'foo();' },
    ]);
  });
});

describe('parseInline', () => {
  it('finds inline code, bold and citation markers', () => {
    expect(parseInline('Call **`login()`** in `auth.ts` [1, 3] then [2].')).toEqual([
      { type: 'text', text: 'Call ' },
      { type: 'bold', text: '`login()`' },
      { type: 'text', text: ' in ' },
      { type: 'code', text: 'auth.ts' },
      { type: 'text', text: ' ' },
      { type: 'cite', markers: [1, 3] },
      { type: 'text', text: ' then ' },
      { type: 'cite', markers: [2] },
      { type: 'text', text: '.' },
    ]);
  });

  it('leaves markup-looking text as text', () => {
    expect(parseInline('<script>alert(1)</script> [x]')).toEqual([
      { type: 'text', text: '<script>alert(1)</script> [x]' },
    ]);
  });
});

describe('parseSseBlock', () => {
  it('reads the data line as JSON', () => {
    expect(parseSseBlock('event: token\ndata: {"type":"token","text":"hi"}')).toEqual({
      type: 'token',
      text: 'hi',
    });
    expect(parseSseBlock(': keep-alive')).toBeNull();
    expect(parseSseBlock('data: not json')).toBeNull();
  });
});

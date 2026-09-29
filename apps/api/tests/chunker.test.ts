import { beforeAll, describe, expect, it } from 'vitest';
import { buildChunks, buildSearchText, splitIdentifier } from '../src/indexing/chunker';
import { buildCodeGraph, type SourceFile } from '../src/indexing/graph';
import { createCodeParser, type CodeParser } from '../src/indexing/parser';

let parser: CodeParser;
beforeAll(async () => {
  parser = await createCodeParser();
});

const code = (path: string, content: string): SourceFile => ({
  path,
  content,
  kind: 'CODE',
  language: 'typescript',
});
const doc = (path: string, content: string): SourceFile => ({
  path,
  content,
  kind: 'DOC',
  language: 'markdown',
});

function chunk(files: SourceFile[], maxLines?: number) {
  return buildChunks(files, buildCodeGraph(files, parser), maxLines ? { maxLines } : {});
}

const summary = (chunks: ReturnType<typeof chunk>) =>
  chunks.map((c) => `${c.kind} ${c.label ?? '-'} ${c.startLine}-${c.endLine}`);

describe('code chunks', () => {
  const source = `import { Router } from 'express';
import { db } from './db';
import * as crypto from 'node:crypto';

/** Creates a user. */
export async function createUser(name: string) {
  return db.insert({ name });
}

export const router = Router();
router.post('/users', createUser);
router.get('/health', (req, res) => res.send('ok'));

type Role = 'admin' | 'user';
`;

  it('creates one chunk per symbol plus chunks for module-level code', () => {
    expect(summary(chunk([code('src/users.ts', source)]))).toEqual([
      'symbol createUser 6-8',
      'symbol router 10-10',
      'module - 11-12',
      'symbol Role 14-14',
    ]);
  });

  it('adds a context header naming the file, symbol and the imports it uses', () => {
    const [createUser, , module] = chunk([code('src/users.ts', source)]);
    expect(createUser?.header).toBe(
      [
        '// file: src/users.ts',
        '// symbol: createUser (function, exported)',
        '// imports used: ./db',
      ].join('\n'),
    );
    expect(createUser?.content).toBe(
      'export async function createUser(name: string) {\n  return db.insert({ name });\n}',
    );
    expect(module?.header).toBe('// file: src/users.ts\n// symbol: module scope, lines 11–12');
  });

  it('splits large classes into a header chunk and one chunk per method', () => {
    const body = Array.from({ length: 8 }, (_, i) => `    step${i}();`).join('\n');
    const cls = `export class Checkout {
  private total = 0;
  submit() {
${body}
  }
  cancel() {
${body}
  }
}`;
    expect(summary(chunk([code('src/checkout.ts', cls)], 12))).toEqual([
      'symbol Checkout 1-2',
      'symbol Checkout.submit 3-12',
      'symbol Checkout.cancel 13-22',
    ]);
  });

  it('keeps small classes whole', () => {
    const cls = 'export class A {\n  a() {}\n  b() {}\n}';
    expect(summary(chunk([code('a.ts', cls)]))).toEqual(['symbol A 1-4']);
  });

  it('splits oversized symbols into labelled parts', () => {
    const fn = `function long() {\n${Array.from({ length: 25 }, (_, i) => `  x${i}();`).join('\n')}\n}`;
    const parts = chunk([code('long.ts', fn)], 10);
    expect(summary(parts)).toEqual(['symbol long 1-10', 'symbol long 11-20', 'symbol long 21-27']);
    expect(parts[1]?.header).toContain('[part 2/3]');
  });

  it('ignores module scope that is only imports, comments and braces', () => {
    const file = `import a from 'a';\n// comment\n\nexport function f() {}\n\n'use strict';\n`;
    expect(summary(chunk([code('f.ts', file)]))).toEqual(['symbol f 4-4']);
  });
});

describe('doc chunks', () => {
  it('splits markdown by heading and ignores headings inside code fences', () => {
    const md = `# Payments API

Charges customers.

## Setup

Run it:

\`\`\`bash
# not a heading
npm start
\`\`\`

## Empty

## Usage
Call POST /payments.
`;
    const chunks = chunk([doc('README.md', md)]);
    expect(summary(chunks)).toEqual(['doc Payments API 1-4', 'doc Setup 5-13', 'doc Usage 16-18']);
    expect(chunks[1]?.header).toBe('<!-- file: README.md · section: Setup -->');
  });

  it('skips config files', () => {
    const config: SourceFile = {
      path: 'package.json',
      content: '{}',
      kind: 'CONFIG',
      language: 'json',
    };
    expect(chunk([config])).toEqual([]);
  });
});

describe('search text', () => {
  it('splits identifiers so word queries match camelCase and snake_case', () => {
    expect(splitIdentifier('getUserByID')).toEqual(['get', 'user', 'by', 'id']);
    expect(splitIdentifier('MAX_FILE_KB')).toEqual(['max', 'file', 'kb']);
    expect(splitIdentifier('parseHTTPResponse')).toEqual(['parse', 'http', 'response']);
    expect(splitIdentifier('x')).toEqual([]);
  });

  it('keeps the original text and appends split words once', () => {
    const text = buildSearchText(
      'src/userService.ts',
      'UserService.getById',
      'getById(); getById();',
    );
    expect(text).toContain('getById(); getById();');
    expect(text.split('\n').at(-1)).toBe('user service get by id');
  });
});

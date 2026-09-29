import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { extractTarball, LimitExceededError, type ExtractLimits } from '../src/indexing/tarball';
import { makeTarball, toWebStream } from './support/tar';

const limits: ExtractLimits = {
  maxArchiveBytes: 10 * 1024 * 1024,
  maxFileBytes: 200 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxCodeFiles: 100,
};

const extract = (tarball: Buffer, overrides: Partial<ExtractLimits> = {}) =>
  extractTarball(toWebStream(tarball), { ...limits, ...overrides });

describe('extractTarball', () => {
  it('strips the top-level folder and returns classified files with metadata', async () => {
    const result = await extract(
      makeTarball([
        { path: '', type: 'Directory' },
        { path: 'src/index.ts', content: 'export const a = 1;\nexport const b = 2;\n' },
        { path: 'README.md', content: '# Hello' },
        { path: 'package.json', content: '{"name":"x"}' },
      ]),
    );

    expect(result.files.map((f) => [f.path, f.kind, f.language])).toEqual([
      ['package.json', 'CONFIG', 'json'],
      ['README.md', 'DOC', 'markdown'],
      ['src/index.ts', 'CODE', 'typescript'],
    ]);
    const index = result.files.find((f) => f.path === 'src/index.ts')!;
    expect(index).toMatchObject({ sizeBytes: 40, lineCount: 3 });
    expect(index.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.skipped).toEqual({});
  });

  it('accepts Node streams as well as web streams', async () => {
    const tarball = makeTarball([{ path: 'a.ts', content: 'export {}' }]);
    const result = await extractTarball(Readable.from([tarball]), limits);
    expect(result.files).toHaveLength(1);
  });

  it('skips path traversal, absolute paths and links without failing the job', async () => {
    const result = await extract(
      makeTarball([
        { path: 'ok.ts', content: 'export {}' },
        { path: '../escape.ts', content: 'export {}' },
        { path: '/etc/cron.d/evil.ts', content: 'export {}' },
        { path: 'link.ts', type: 'SymbolicLink', linkpath: '/etc/passwd' },
        { path: 'hard.ts', type: 'Link', linkpath: 'ok.ts' },
      ]),
    );

    expect(result.files.map((f) => f.path)).toEqual(['ok.ts']);
    expect(result.skipped).toEqual({ 'unsafe-path': 2, 'not-a-regular-file': 2 });
  });

  it('counts skipped files by reason', async () => {
    const result = await extract(
      makeTarball([
        { path: 'node_modules/x/index.js', content: 'x' },
        { path: 'package-lock.json', content: '{}' },
        { path: 'logo.png', content: 'png' },
        { path: 'big.ts', content: 'x'.repeat(300) },
        { path: 'bin.ts', content: Buffer.from([1, 0, 2]) },
        { path: 'gen.ts', content: '// @generated\nexport {}' },
      ]),
      { maxFileBytes: 200 },
    );

    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual({
      'ignored-directory': 1,
      lockfile: 1,
      'unsupported-type': 1,
      'too-large': 1,
      binary: 1,
      generated: 1,
    });
  });

  it('fails with a readable limit error when there are too many source files', async () => {
    const entries = Array.from({ length: 4 }, (_, i) => ({ path: `f${i}.ts`, content: 'x' }));
    await expect(extract(makeTarball(entries), { maxCodeFiles: 3 })).rejects.toEqual(
      new LimitExceededError('Repository has more than 3 source files, the current limit.'),
    );
  });

  it('does not count skipped code files toward the source-file limit', async () => {
    const result = await extract(
      makeTarball([
        { path: 'a.ts', content: 'export {}' },
        { path: 'gen.ts', content: '// @generated\n' },
      ]),
      { maxCodeFiles: 1 },
    );
    expect(result.files).toHaveLength(1);
  });

  it('stops reading once the compressed archive exceeds the size limit', async () => {
    const random = Buffer.from(
      Array.from({ length: 50_000 }, () => Math.floor(Math.random() * 256)),
    );
    const tarball = makeTarball([{ path: 'noise.ts', content: random }]);
    await expect(extract(tarball, { maxArchiveBytes: 10_000 })).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });

  it('fails when accepted files exceed the total size limit', async () => {
    const result = extract(
      makeTarball([
        { path: 'a.ts', content: 'a'.repeat(600) },
        { path: 'b.ts', content: 'b'.repeat(600) },
      ]),
      { maxTotalBytes: 1_000 },
    );
    await expect(result).rejects.toThrow(/larger than 0 MB/);
  });

  it('returns no files for input that is not a tarball', async () => {
    await expect(extract(Buffer.from('not a tarball at all'))).resolves.toEqual({
      files: [],
      skipped: {},
    });
  });
});

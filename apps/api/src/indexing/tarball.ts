import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Parser, type ReadEntry } from 'tar';
import {
  classifyPath,
  inspectContent,
  safeRelativePath,
  type FileClass,
  type SkipReason,
} from './filter';

export interface ExtractLimits {
  /** Compressed archive size. */
  maxArchiveBytes: number;
  maxFileBytes: number;
  /** Sum of all accepted files, uncompressed. Bounds memory use. */
  maxTotalBytes: number;
  maxCodeFiles: number;
}

export interface ExtractedFile extends FileClass {
  path: string;
  content: string;
  sizeBytes: number;
  lineCount: number;
  contentHash: string;
}

export interface ExtractResult {
  files: ExtractedFile[];
  skipped: Partial<Record<SkipReason, number>>;
}

/** Limits the user can act on (a smaller repo, a different ref). Not worth retrying. */
export class LimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LimitExceededError';
  }
}

const REGULAR_FILE_TYPES = new Set(['File', 'OldFile', 'ContiguousFile']);
const HEADER_TYPES = new Set(['GlobalExtendedHeader', 'ExtendedHeader', 'Directory']);

/**
 * Reads a GitHub tarball entirely in memory: nothing is written to disk, so path
 * traversal and symlink tricks have no filesystem to act on. Limits are enforced
 * while streaming, so an oversized archive is abandoned early.
 */
export async function extractTarball(
  source: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
  limits: ExtractLimits,
): Promise<ExtractResult> {
  const files: ExtractedFile[] = [];
  const skipped: Partial<Record<SkipReason, number>> = {};
  const skip = (reason: SkipReason) => (skipped[reason] = (skipped[reason] ?? 0) + 1);
  let totalBytes = 0;
  let codeFiles = 0;

  const input =
    source instanceof ReadableStream
      ? Readable.fromWeb(source as WebReadableStream<Uint8Array>)
      : Readable.from(source);

  return new Promise<ExtractResult>((resolve, reject) => {
    let failed = false;
    const fail = (err: unknown) => {
      if (failed) return;
      failed = true;
      input.destroy();
      reject(err);
    };

    let archiveBytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        archiveBytes += chunk.length;
        if (archiveBytes > limits.maxArchiveBytes) {
          callback(
            new LimitExceededError(
              `Repository archive is larger than ${formatMb(limits.maxArchiveBytes)}.`,
            ),
          );
          return;
        }
        callback(null, chunk);
      },
    });

    const parser = new Parser({
      strict: false,
      onReadEntry(entry: ReadEntry) {
        if (failed) return entry.resume();
        if (HEADER_TYPES.has(entry.type)) return entry.resume();
        if (!REGULAR_FILE_TYPES.has(entry.type)) {
          skip('not-a-regular-file');
          return entry.resume();
        }

        // Validate the raw path first (so "/etc/x" can't lose its leading slash below),
        // then drop the "<owner>-<repo>-<sha>/" folder GitHub wraps everything in.
        const rawPath = safeRelativePath(entry.path);
        const path = rawPath && safeRelativePath(rawPath.split('/').slice(1).join('/'));
        if (!path) {
          skip('unsafe-path');
          return entry.resume();
        }
        const cls = classifyPath(path);
        if ('skip' in cls) {
          skip(cls.skip);
          return entry.resume();
        }
        if ((entry.size ?? 0) > limits.maxFileBytes) {
          skip('too-large');
          return entry.resume();
        }
        const chunks: Buffer[] = [];
        entry.on('data', (chunk: Buffer) => chunks.push(chunk));
        entry.on('end', () => {
          if (failed) return;
          const bytes = Buffer.concat(chunks);
          const text = bytes.toString('utf8');
          const reason = inspectContent(bytes, text, cls);
          if (reason) {
            skip(reason);
            return;
          }
          // Counted after inspection so generated/minified files don't use up the limit.
          if (cls.kind === 'CODE' && ++codeFiles > limits.maxCodeFiles) {
            return fail(
              new LimitExceededError(
                `Repository has more than ${limits.maxCodeFiles.toLocaleString('en-US')} source files, the current limit.`,
              ),
            );
          }
          totalBytes += bytes.length;
          if (totalBytes > limits.maxTotalBytes) {
            return fail(
              new LimitExceededError(
                `Repository source is larger than ${formatMb(limits.maxTotalBytes)}, the current limit.`,
              ),
            );
          }
          files.push({
            ...cls,
            path,
            content: text,
            sizeBytes: bytes.length,
            lineCount: text.length === 0 ? 0 : text.split('\n').length,
            contentHash: createHash('sha256').update(bytes).digest('hex'),
          });
        });
      },
    });

    input.on('error', fail);
    counter.on('error', fail);
    parser.on('error', fail);
    parser.on('end', () => {
      if (!failed) resolve({ files: files.sort((a, b) => a.path.localeCompare(b.path)), skipped });
    });
    input.pipe(counter).pipe(parser);
  });
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

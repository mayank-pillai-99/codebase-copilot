import { gzipSync } from 'node:zlib';
import { Header } from 'tar';

export interface TarEntry {
  path: string;
  content?: string | Buffer;
  type?: 'File' | 'SymbolicLink' | 'Link' | 'Directory';
  linkpath?: string;
}

/**
 * Builds a gzipped tarball in memory, byte for byte, so tests can include entries
 * that normal archivers refuse to create (../ paths, absolute paths, symlinks).
 */
export function makeTarball(entries: TarEntry[], prefix = 'owner-repo-abc1234/'): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body =
      entry.content === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(entry.content)
          ? entry.content
          : Buffer.from(entry.content);
    const header = new Header({
      path: entry.path.startsWith('/') ? entry.path : `${prefix}${entry.path}`,
      mode: 0o644,
      size: entry.type && entry.type !== 'File' ? 0 : body.length,
      mtime: new Date(0),
      type: entry.type ?? 'File',
      ...(entry.linkpath && { linkpath: entry.linkpath }),
    });
    const block = Buffer.alloc(512);
    header.encode(block, 0);
    blocks.push(block);
    if (!entry.type || entry.type === 'File') {
      blocks.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

export function toWebStream(buffer: Buffer, chunkSize = 4096): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= buffer.length) return controller.close();
      controller.enqueue(new Uint8Array(buffer.subarray(offset, offset + chunkSize)));
      offset += chunkSize;
    },
  });
}

// Fails when the database schema and prisma/schema.prisma disagree.
//
// One difference is expected: Prisma can't declare HNSW indexes, so it always
// proposes dropping the pgvector index created by hand in the add_chunks migration.
// Any other difference means a migration is missing or was edited incorrectly.
// When creating migrations with `prisma migrate dev --create-only`, delete the
// generated DROP INDEX line for this index before applying.
import { execFileSync } from 'node:child_process';

const EXPECTED = new Set(['DROP INDEX "chunks_embedding_hnsw_idx";']);

const output = execFileSync(
  'npx',
  [
    'prisma',
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--script',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
);

const statements = output
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('--'));
const unexpected = statements.filter((line) => !EXPECTED.has(line));

if (unexpected.length > 0) {
  console.error('Schema drift detected. prisma migrate diff wants to run:\n');
  console.error(unexpected.map((line) => `  ${line}`).join('\n'));
  process.exit(1);
}
console.log('No schema drift (ignoring the hand-written HNSW index).');

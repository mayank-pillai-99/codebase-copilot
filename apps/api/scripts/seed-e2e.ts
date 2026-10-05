/**
 * Seeds the browser tests' demo repository (e2e/payments-api) by indexing the in-memory
 * fixture repo, so the end-to-end run needs neither GitHub nor Gemini. With a READY
 * snapshot in place, the API's demo seeding skips it at startup.
 *
 * Usage: DATABASE_URL=... tsx scripts/seed-e2e.ts
 */
import type { GitHubClient } from '../src/github/client';
import { createIndexer } from '../src/indexing/indexer';
import { createCodeParser } from '../src/indexing/parser';
import { createPrisma } from '../src/lib/prisma';
import { fixtureEntries } from '../tests/support/fixture-repo';
import { makeTarball, toWebStream } from '../tests/support/tar';

const E2E_OWNER = 'e2e';
const E2E_NAME = 'payments-api';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

const prisma = createPrisma(DATABASE_URL);
try {
  // Start from a clean snapshot each run; cascades remove its files, symbols and chunks.
  await prisma.repository.deleteMany({ where: { owner: E2E_OWNER, name: E2E_NAME } });
  const repository = await prisma.repository.create({
    data: { owner: E2E_OWNER, name: E2E_NAME, defaultBranch: 'main' },
  });
  const snapshot = await prisma.snapshot.create({
    data: { repositoryId: repository.id, commitSha: 'e2e0'.repeat(10), ref: 'main' },
  });
  const github: GitHubClient = {
    getRepository: async () => {
      throw new Error('not used when seeding');
    },
    resolveCommit: async () => snapshot.commitSha,
    downloadTarball: async () => toWebStream(makeTarball(fixtureEntries())),
  };
  await createIndexer({
    prisma,
    github,
    getParser: createCodeParser,
    embedder: null,
    limits: {
      maxArchiveBytes: 1e7,
      maxFileBytes: 2e5,
      maxTotalBytes: 1e7,
      maxCodeFiles: 100,
      maxChunks: 1000,
    },
    logger: console,
  })(snapshot.id, { isFinalAttempt: true });

  const { status } = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
  if (status !== 'READY') throw new Error(`Seeding failed: snapshot is ${status}`);
  console.log(`Seeded ${E2E_OWNER}/${E2E_NAME} (snapshot ${snapshot.id})`);
} finally {
  await prisma.$disconnect();
}

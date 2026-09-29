import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * An evaluation dataset (SPEC §8.1): a directory holding `repos.json` (the repositories,
 * pinned to commits) and `questions.jsonl` (one question per line, labelled with the
 * files that answer it).
 */

export const QUESTION_TYPES = ['conceptual', 'locational', 'flow', 'vocabulary'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

const repoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'expected owner/name');

const manifestSchema = z.object({
  version: z.string().min(1),
  repos: z
    .array(
      z.object({
        repo: repoName,
        sha: z.string().regex(/^[0-9a-f]{40}$/, 'expected a full commit SHA'),
        description: z.string().min(1),
      }),
    )
    .min(1),
  /**
   * The human check of LLM-drafted questions: a seeded random sample, and what the
   * reviewer did with it. Absent until the check is done; runs can't be published
   * without it.
   */
  review: z
    .object({
      method: z.literal('random-sample'),
      seed: z.number().int(),
      sampled: z.number().int().positive(),
      kept: z.number().int().nonnegative(),
      edited: z.number().int().nonnegative(),
      dropped: z.number().int().nonnegative(),
    })
    .refine((r) => r.kept + r.edited + r.dropped === r.sampled, {
      message: 'kept + edited + dropped must equal sampled',
    })
    .optional(),
});

export const questionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  repo: repoName,
  type: z.enum(QUESTION_TYPES),
  question: z.string().min(8),
  /** Paths (at the pinned commit) of the files that answer the question. */
  gold: z.array(z.string().min(1)).min(1),
  /** Who wrote the question. */
  source: z.enum(['human', 'llm-drafted']),
  /** A person checked this question (in the review sample, or wrote it). */
  reviewed: z.boolean(),
  note: z.string().optional(),
});

export type RepoManifest = z.infer<typeof manifestSchema>;
export type EvalQuestion = z.infer<typeof questionSchema>;

export interface EvalDataset {
  /** Manifest version plus a hash of the questions, so any edit is visible in results. */
  version: string;
  repos: RepoManifest['repos'];
  review: RepoManifest['review'] | null;
  questions: EvalQuestion[];
}

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetError';
  }
}

export async function loadDataset(dir: string): Promise<EvalDataset> {
  const manifestText = await readFile(join(dir, 'repos.json'), 'utf8');
  const questionsText = await readFile(join(dir, 'questions.jsonl'), 'utf8');
  return parseDataset(manifestText, questionsText);
}

export function parseDataset(manifestText: string, questionsText: string): EvalDataset {
  const manifest = manifestSchema.parse(JSON.parse(manifestText));
  const repos = new Set(manifest.repos.map((r) => r.repo));
  if (repos.size !== manifest.repos.length) throw new DatasetError('repos.json lists a repo twice');

  const questions: EvalQuestion[] = [];
  const ids = new Set<string>();
  questionsText.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    const where = `questions.jsonl line ${index + 1}`;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new DatasetError(`${where}: not valid JSON`);
    }
    const parsed = questionSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      throw new DatasetError(`${where}: ${issue.path.join('.')} ${issue.message}`);
    }
    const question = parsed.data;
    if (ids.has(question.id)) throw new DatasetError(`${where}: duplicate id ${question.id}`);
    if (!repos.has(question.repo)) {
      throw new DatasetError(`${where}: ${question.repo} is not in repos.json`);
    }
    if (new Set(question.gold).size !== question.gold.length) {
      throw new DatasetError(`${where}: duplicate gold path`);
    }
    ids.add(question.id);
    questions.push(question);
  });
  if (questions.length === 0) throw new DatasetError('questions.jsonl has no questions');

  const hash = createHash('sha256').update(questionsText).digest('hex').slice(0, 8);
  return {
    version: `${manifest.version}+${hash}`,
    repos: manifest.repos,
    review: manifest.review ?? null,
    questions,
  };
}

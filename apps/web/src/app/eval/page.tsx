import {
  evalLatestResponseSchema,
  evalQuestionTypes,
  type EvalQuestionResult,
  type EvalRetrieverReport,
  type EvalRun,
} from '@codebase-copilot/shared';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ServerWaking } from '@/components/server-waking';
import { bestLabels, formatMetric, formatMs, METRICS } from '@/lib/eval';
import { githubBlobUrl, shortSha } from '@/lib/format';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = {
  title: 'Retrieval evaluation · Codebase Copilot',
  description: 'How well each retrieval strategy finds the code that answers a question.',
};

// Results are imported when the API starts; read them per request.
export const dynamic = 'force-dynamic';

const DATASET_URL =
  'https://github.com/mayank-pillai-99/codebase-copilot/tree/main/eval/datasets/v1';

const TYPE_LABELS: Record<(typeof evalQuestionTypes)[number], string> = {
  conceptual: 'Conceptual',
  locational: 'Locational',
  flow: 'Flow',
  vocabulary: 'Vocabulary mismatch',
};

export default async function EvalPage() {
  const result = await serverApi('/api/eval/latest', evalLatestResponseSchema);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Retrieval evaluation</h1>
        <p className="max-w-3xl text-zinc-600 dark:text-zinc-400">
          Before the model writes an answer, a retriever has to find the right code. This page
          measures how often each retrieval strategy finds the files that answer a question, on
          open-source repositories pinned to exact commits.
        </p>
      </header>

      {!result.ok && result.unreachable ? (
        <ServerWaking />
      ) : !result.ok ? (
        <p className="text-sm text-red-700 dark:text-red-400">{result.error}</p>
      ) : !result.data.run ? (
        <p className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          Not measured yet: no evaluation has been run.
        </p>
      ) : (
        <Results run={result.data.run} />
      )}
    </main>
  );
}

function Results({ run }: { run: EvalRun }) {
  const { retrievers } = run.metrics;
  const { config } = run;
  const date = new Date(run.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <>
      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <Fact label="Questions" value={config.questions.toLocaleString('en-US')} />
        <Fact label="Repositories" value={String(config.repos.length)} />
        <Fact label="Run on" value={date} />
        <Fact label="Embedding model" value={config.embeddingModel} />
      </dl>

      <Section title="Overall">
        <Table head={['Retriever', ...METRICS.map((m) => m.label), 'Latency p50', 'Latency p95']}>
          {retrievers.map((r) => (
            <tr key={r.label}>
              <RowLabel>{r.label}</RowLabel>
              {METRICS.map((m) => (
                <Cell key={m.key} best={bestLabels(retrievers, (s) => s[m.key]).has(r.label)}>
                  {formatMetric(m.key, r.overall[m.key])}
                </Cell>
              ))}
              <Cell>{formatMs(r.latencyMs.p50)}</Cell>
              <Cell>{formatMs(r.latencyMs.p95)}</Cell>
            </tr>
          ))}
        </Table>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Bold marks the best value in each column. Latency is database time per question. Vector
          and hybrid retrieval also embed the question once: p50{' '}
          {formatMs(run.metrics.queryEmbeddingMs.p50)}, p95{' '}
          {formatMs(run.metrics.queryEmbeddingMs.p95)} over {run.metrics.queryEmbeddingMs.calls}{' '}
          calls to the embedding API. No retriever calls an LLM.
        </p>
      </Section>

      <Section title="Recall@5 by question type">
        <Breakdown
          retrievers={retrievers}
          columns={evalQuestionTypes
            .filter((type) => retrievers[0]?.byType[type])
            .map((type) => ({
              key: type,
              label: `${TYPE_LABELS[type]} (${retrievers[0]!.byType[type]!.questions})`,
              scores: (r: EvalRetrieverReport) => r.byType[type],
            }))}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Conceptual: “how does auth work?” · Locational: “where is X done?” · Flow: “what happens
          on POST /x?” · Vocabulary mismatch: phrased without the words the code uses.
        </p>
      </Section>

      <Section title="Recall@5 by repository">
        <Breakdown
          retrievers={retrievers}
          columns={config.repos.map(({ repo }) => ({
            key: repo,
            label: `${repo.split('/')[1]} (${retrievers[0]?.byRepo[repo]?.questions ?? 0})`,
            scores: (r: EvalRetrieverReport) => r.byRepo[repo],
          }))}
        />
        <ul className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          {config.repos.map(({ repo, sha, description }) => (
            <li key={repo}>
              <a
                href={`https://github.com/${repo}/tree/${sha}`}
                className="font-medium text-sky-700 hover:underline dark:text-sky-400"
              >
                {repo} @ {shortSha(sha)}
              </a>{' '}
              · {description}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Every question">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The top five files each retriever returned. Answer files are marked ✓.
        </p>
        <div className="flex flex-col gap-2">
          {config.repos.map(({ repo, sha }) => (
            <QuestionGroup
              key={repo}
              repo={repo}
              sha={sha}
              questions={run.results.filter((q) => q.repo === repo)}
              labels={retrievers.map((r) => r.label)}
            />
          ))}
        </div>
      </Section>

      <Section title="Method">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            Each question is labelled with the files that answer it. Retrievers return chunks
            (usually one function or class each), which are collapsed into a ranked list of files; a
            file ranks where its best chunk ranks.
          </li>
          <li>
            Every retriever is asked for {config.k} chunks per question.{' '}
            {METRICS.map((m) => `${m.label}: ${m.help.toLowerCase()}`).join('. ')}.
          </li>
          <li>
            <strong>vector</strong>: embedding similarity only. <strong>fulltext</strong>: Postgres
            full-text search with identifiers split into words. <strong>hybrid (no graph)</strong>:
            both, fused with Reciprocal Rank Fusion. <strong>hybrid</strong>: the same plus one hop
            along the call graph; this is what chat uses.
          </li>
          <li>
            Questions: {config.questionSources.human} written by a person and{' '}
            {config.questionSources.llmDrafted} drafted by an LLM, then reviewed by a person before
            inclusion. The questions and answer files are{' '}
            <a
              href={DATASET_URL}
              className="font-medium text-sky-700 hover:underline dark:text-sky-400"
            >
              in the repository
            </a>{' '}
            (dataset {run.datasetVersion}, code {run.config.codeVersion}).
          </li>
          <li>
            Answer quality (whether generated answers are grounded and correctly cited) is not
            measured yet.
          </li>
        </ul>
      </Section>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 font-medium break-words">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">{children}</tbody>
      </table>
    </div>
  );
}

function RowLabel({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{children}</td>;
}

function Cell({ children, best = false }: { children: ReactNode; best?: boolean }) {
  return (
    <td
      className={`px-3 py-2 text-right tabular-nums ${best ? 'font-semibold' : 'text-zinc-600 dark:text-zinc-400'}`}
    >
      {children}
    </td>
  );
}

function Breakdown({
  retrievers,
  columns,
}: {
  retrievers: EvalRetrieverReport[];
  columns: {
    key: string;
    label: string;
    scores: (r: EvalRetrieverReport) => EvalRetrieverReport['overall'] | undefined;
  }[];
}) {
  return (
    <Table head={['Retriever', ...columns.map((c) => c.label)]}>
      {retrievers.map((r) => (
        <tr key={r.label}>
          <RowLabel>{r.label}</RowLabel>
          {columns.map((c) => {
            const scores = c.scores(r);
            return (
              <Cell
                key={c.key}
                best={bestLabels(retrievers, (s) => s.recall5, c.scores).has(r.label)}
              >
                {scores ? formatMetric('recall5', scores.recall5) : '—'}
              </Cell>
            );
          })}
        </tr>
      ))}
    </Table>
  );
}

function QuestionGroup({
  repo,
  sha,
  questions,
  labels,
}: {
  repo: string;
  sha: string;
  questions: EvalQuestionResult[];
  labels: string[];
}) {
  const [owner, name] = repo.split('/') as [string, string];
  return (
    <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        {repo} · {questions.length} questions
      </summary>
      <ol className="flex flex-col divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {questions.map((q) => {
          const gold = new Set(q.gold);
          return (
            <li key={q.id} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{q.question}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {q.id} · {TYPE_LABELS[q.type]} · answer files:{' '}
                  {q.gold.map((path, i) => (
                    <span key={path}>
                      {i > 0 && ', '}
                      <a
                        href={githubBlobUrl({ owner, name }, sha, path)}
                        className="font-mono text-sky-700 hover:underline dark:text-sky-400"
                      >
                        {path}
                      </a>
                    </span>
                  ))}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {labels.map((label) => {
                  const r = q.results[label];
                  if (!r) return null;
                  return (
                    <div key={label} className="min-w-0 text-xs">
                      <p className="mb-1 font-mono text-zinc-500 dark:text-zinc-400">
                        {label} · R@5 {formatMetric('recall5', r.scores.recall5)}
                      </p>
                      <ol className="flex flex-col gap-0.5">
                        {r.files.slice(0, 5).map((path) => (
                          <li
                            key={path}
                            className={`truncate font-mono ${gold.has(path) ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-400'}`}
                            title={path}
                          >
                            {gold.has(path) ? '✓ ' : ''}
                            {path}
                          </li>
                        ))}
                        {r.files.length === 0 && (
                          <li className="text-zinc-500 dark:text-zinc-400">No results</li>
                        )}
                      </ol>
                    </div>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

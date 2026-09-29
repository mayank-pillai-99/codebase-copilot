'use client';

import {
  chatEventSchema,
  type ChatCitation,
  type ChatMessageDto,
  type ChatSessionSummary,
  type ChatSource,
} from '@codebase-copilot/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { codeHref } from '@/lib/format';
import { parseSseBlock } from '@/lib/markdown';
import { AnswerText, type CitationTarget } from './answer-text';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: ChatCitation[];
  /** Everything retrieved for this answer (while streaming, before citations are final). */
  sources: ChatSource[];
  flagged: boolean;
  streaming: boolean;
  error: string | null;
}

const STARTERS = [
  'Give me an overview of how this project is structured.',
  'Where are the HTTP routes defined, and what do they do?',
  'How does authentication work?',
  'How is data stored and accessed?',
];

export function ChatPanel({
  snapshotId,
  sessions,
  initialSessionId,
  initialMessages,
}: {
  snapshotId: string;
  sessions: ChatSessionSummary[];
  initialSessionId: string | null;
  initialMessages: ChatMessageDto[];
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [messages, setMessages] = useState<UiMessage[]>(() =>
    initialMessages.map((m) => ({ ...m, sources: [], streaming: false, error: null })),
  );
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const updateLast = (update: (m: UiMessage) => UiMessage) =>
    setMessages((all) => [...all.slice(0, -1), update(all.at(-1)!)]);

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setFormError(null);
    setInput('');
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    setMessages((all) => [
      ...all,
      {
        id: `u-${all.length}`,
        role: 'user',
        content: text,
        citations: [],
        sources: [],
        flagged: false,
        streaming: false,
        error: null,
      },
      {
        id: `a-${all.length}`,
        role: 'assistant',
        content: '',
        citations: [],
        sources: [],
        flagged: false,
        streaming: true,
        error: null,
      },
    ]);

    try {
      const res = await fetch(`/api/snapshots/${snapshotId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, ...(sessionId && { sessionId }) }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const body: { error?: string; issues?: { message: string }[] } = await res
          .json()
          .catch(() => ({}));
        throw new Error(
          res.status === 429 && !body.error
            ? 'You are asking faster than the limit allows. Wait a minute and try again.'
            : (body.issues?.[0]?.message ??
                body.error ??
                'Something went wrong. Please try again.'),
        );
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const parsed = chatEventSchema.safeParse(parseSseBlock(block));
          if (!parsed.success) continue;
          const event = parsed.data;
          if (event.type === 'session' && event.sessionId !== sessionId) {
            setSessionId(event.sessionId);
            router.replace(`/repos/${snapshotId}/chat?session=${event.sessionId}`, {
              scroll: false,
            });
          } else if (event.type === 'sources') {
            updateLast((m) => ({ ...m, sources: event.sources }));
          } else if (event.type === 'token') {
            updateLast((m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === 'done') {
            updateLast((m) => ({
              ...m,
              id: event.messageId,
              content: event.content,
              citations: event.citations,
              flagged: event.flagged,
              streaming: false,
            }));
          } else if (event.type === 'error') {
            updateLast((m) => ({ ...m, streaming: false, error: event.message }));
          }
        }
      }
      updateLast((m) => ({ ...m, streaming: false }));
    } catch (err) {
      if (abort.signal.aborted) {
        updateLast((m) => ({ ...m, streaming: false, error: m.content ? null : 'Stopped.' }));
      } else {
        // Nothing was answered: drop the placeholder and show why.
        setMessages((all) => all.slice(0, -1));
        setFormError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-2">
        <Link
          href={`/repos/${snapshotId}/chat`}
          onClick={() => {
            setSessionId(null);
            setMessages([]);
          }}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-center text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          New conversation
        </Link>
        {sessions.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/repos/${snapshotId}/chat?session=${s.id}`}
                  aria-current={s.id === sessionId ? 'page' : undefined}
                  className={`block truncate rounded px-2 py-1 text-xs ${
                    s.id === sessionId
                      ? 'bg-zinc-200 dark:bg-zinc-800'
                      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
                  }`}
                  title={s.title}
                >
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="flex min-w-0 flex-col gap-4">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-zinc-300 p-6 dark:border-zinc-700">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Ask anything about this codebase. Answers cite the exact files and lines they come
              from.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-left text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-5" aria-live="polite">
            {messages.map((m) => (
              <li key={m.id}>
                {m.role === 'user' ? (
                  <UserBubble text={m.content} />
                ) : (
                  <Answer m={m} snapshotId={snapshotId} />
                )}
              </li>
            ))}
          </ol>
        )}
        <div ref={bottomRef} />

        <form onSubmit={onSubmit} className="sticky bottom-4 flex flex-col gap-2">
          {formError && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
            >
              {formError}
            </p>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-zinc-300 bg-white p-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              maxLength={2000}
              placeholder="How does authentication work?"
              aria-label="Your question"
              className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Ask
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto max-w-[85%] rounded-2xl bg-zinc-900 px-4 py-2 text-sm whitespace-pre-wrap text-white dark:bg-zinc-100 dark:text-zinc-900">
      {text}
    </div>
  );
}

function Answer({ m, snapshotId }: { m: UiMessage; snapshotId: string }) {
  // While streaming, markers resolve against everything retrieved; once done, only validated citations.
  const targets = new Map<number, CitationTarget>(
    (m.streaming ? m.sources : m.citations).map((c) => [c.marker, c]),
  );

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {m.content ? (
        <AnswerText text={m.content} snapshotId={snapshotId} targets={targets} />
      ) : m.streaming ? (
        <p className="animate-pulse text-sm text-zinc-500">
          {m.sources.length
            ? `Reading ${m.sources.length} code excerpts…`
            : 'Searching the codebase…'}
        </p>
      ) : null}
      {m.error && <p className="text-sm text-red-700 dark:text-red-400">{m.error}</p>}
      {m.flagged && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          The answer cited sources that weren&apos;t provided; those references were removed.
        </p>
      )}
      {!m.streaming && m.citations.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            {m.citations.length} {m.citations.length === 1 ? 'source' : 'sources'}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {m.citations.map((c) => (
              <li key={c.marker}>
                <Link
                  href={codeHref(snapshotId, c.path, c.startLine, c.endLine)}
                  className="font-mono hover:underline"
                >
                  [{c.marker}] {c.path}:{c.startLine}-{c.endLine}
                  {c.label ? ` · ${c.label}` : ''}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

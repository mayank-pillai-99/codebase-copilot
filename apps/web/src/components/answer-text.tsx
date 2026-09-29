import Link from 'next/link';
import type { ReactNode } from 'react';
import { codeHref } from '@/lib/format';
import { parseBlocks, parseInline } from '@/lib/markdown';

export interface CitationTarget {
  marker: number;
  path: string;
  startLine: number;
  endLine: number;
  label: string | null;
}

/** Renders an answer's markdown subset; [n] markers link to the cited lines in the viewer. */
export function AnswerText({
  text,
  snapshotId,
  targets,
}: {
  text: string;
  snapshotId: string;
  targets: Map<number, CitationTarget>;
}) {
  const inline = (value: string): ReactNode[] =>
    parseInline(value).map((part, i) => {
      if (part.type === 'code') {
        return (
          <code
            key={i}
            className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800"
          >
            {part.text}
          </code>
        );
      }
      if (part.type === 'bold') return <strong key={i}>{part.text}</strong>;
      if (part.type === 'cite') {
        return (
          <span key={i} className="whitespace-nowrap">
            {part.markers.map((marker) => {
              const target = targets.get(marker);
              const className =
                'mx-0.5 inline-block rounded bg-sky-100 px-1 align-super text-[0.7em] font-semibold leading-tight text-sky-800 dark:bg-sky-950 dark:text-sky-300';
              return target ? (
                <Link
                  key={marker}
                  href={codeHref(snapshotId, target.path, target.startLine, target.endLine)}
                  title={`${target.path}:${target.startLine}-${target.endLine}${target.label ? ` (${target.label})` : ''}`}
                  className={`${className} hover:bg-sky-200 dark:hover:bg-sky-900`}
                >
                  {marker}
                </Link>
              ) : (
                <span key={marker} className={className}>
                  {marker}
                </span>
              );
            })}
          </span>
        );
      }
      return part.text;
    });

  return (
    <div className="flex flex-col gap-3 text-sm leading-6">
      {parseBlocks(text).map((block, i) => {
        if (block.type === 'code') {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-lg bg-zinc-100 p-3 font-mono text-xs leading-5 dark:bg-zinc-900"
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === 'heading') {
          return (
            <p key={i} className="font-semibold">
              {inline(block.text)}
            </p>
          );
        }
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List
              key={i}
              className={`flex flex-col gap-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {block.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </List>
          );
        }
        return <p key={i}>{inline(block.text)}</p>;
      })}
    </div>
  );
}

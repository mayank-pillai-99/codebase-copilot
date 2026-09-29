'use client';

import type { FileEntry } from '@codebase-copilot/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { codeHref } from '@/lib/format';

interface Folder {
  name: string;
  path: string;
  folders: Folder[];
  files: FileEntry[];
}

function buildTree(files: FileEntry[]): Folder {
  const root: Folder = { name: '', path: '', folders: [], files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let next = folder.folders.find((f) => f.name === part);
      if (!next) {
        next = { name: part, path, folders: [], files: [] };
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.files.push(file);
  }
  const sort = (folder: Folder) => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.files.sort((a, b) => a.path.localeCompare(b.path));
    folder.folders.forEach(sort);
  };
  sort(root);
  return root;
}

export function FileTree({
  files,
  snapshotId,
  currentPath,
}: {
  files: FileEntry[];
  snapshotId: string;
  currentPath: string | null;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => {
    // Expand the folders leading to the current file.
    const initial = new Set<string>();
    const parts = currentPath?.split('/').slice(0, -1) ?? [];
    parts.forEach((_, i) => initial.add(parts.slice(0, i + 1).join('/')));
    return initial;
  });

  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const matches = filter.trim()
    ? files.filter((f) => f.path.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 200)
    : null;

  const fileLink = (file: FileEntry, label: string, depth: number) => (
    <Link
      key={file.path}
      href={codeHref(snapshotId, file.path)}
      aria-current={file.path === currentPath ? 'page' : undefined}
      title={file.path}
      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      className={`block truncate rounded py-0.5 pr-2 font-mono text-xs ${
        file.path === currentPath
          ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
          : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'
      }`}
    >
      {label}
    </Link>
  );

  const renderFolder = (folder: Folder, depth: number): React.ReactNode => (
    <>
      {folder.folders.map((child) => (
        <div key={child.path}>
          <button
            type="button"
            onClick={() => toggle(child.path)}
            aria-expanded={open.has(child.path)}
            style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
            className="flex w-full items-center gap-1 truncate rounded py-0.5 pr-2 text-left font-mono text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            <span aria-hidden className="w-3 shrink-0 text-zinc-400">
              {open.has(child.path) ? '▾' : '▸'}
            </span>
            {child.name}/
          </button>
          {open.has(child.path) && renderFolder(child, depth + 1)}
        </div>
      ))}
      {folder.files.map((file) => fileLink(file, file.path.split('/').pop()!, depth + 1))}
    </>
  );

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={`Filter ${files.length.toLocaleString('en-US')} files`}
        aria-label="Filter files"
        className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <div className="max-h-[70vh] overflow-y-auto">
        {matches ? (
          matches.length ? (
            matches.map((file) => fileLink(file, file.path, 0))
          ) : (
            <p className="px-2 py-1 text-xs text-zinc-500">No matching files</p>
          )
        ) : (
          renderFolder(tree, 0)
        )}
      </div>
    </div>
  );
}

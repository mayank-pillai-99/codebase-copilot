import {
  fileListResponseSchema,
  fileResponseSchema,
  snapshotResponseSchema,
} from '@codebase-copilot/shared';
import { CodeView } from '@/components/code-view';
import { FileTree } from '@/components/file-tree';
import { ReferencesPanel } from '@/components/references-panel';
import { parseLineRange } from '@/lib/format';
import { highlightFile } from '@/lib/highlight';
import { serverApi } from '@/lib/server-api';

export default async function CodePage(props: PageProps<'/repos/[snapshotId]/code'>) {
  const [{ snapshotId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const snapshot = await serverApi(`/api/snapshots/${snapshotId}`, snapshotResponseSchema);
  if (!snapshot.ok) return null;
  if (snapshot.data.snapshot.status !== 'READY') {
    return <Notice>The code browser opens once indexing finishes.</Notice>;
  }

  const list = await serverApi(`/api/snapshots/${snapshotId}/files`, fileListResponseSchema);
  if (!list.ok) return <Notice>{list.error}</Notice>;
  const files = list.data.files;

  // Default to the README so the first view says something about the project.
  const requested = typeof searchParams.path === 'string' ? searchParams.path : null;
  const path =
    requested ??
    files.find((f) => /^readme(\.md)?$/i.test(f.path))?.path ??
    files.find((f) => f.kind === 'CODE')?.path ??
    null;

  const file = path
    ? await serverApi(
        `/api/snapshots/${snapshotId}/file?path=${encodeURIComponent(path)}`,
        fileResponseSchema,
      )
    : null;
  const highlight = parseLineRange(searchParams.lines);
  const lines = file?.ok
    ? await highlightFile(file.data.file.path, file.data.file.language, file.data.file.content)
    : null;

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_18rem]">
      <aside className="min-w-0">
        <FileTree files={files} snapshotId={snapshotId} currentPath={path} />
      </aside>
      {file?.ok && lines ? (
        <CodeView
          key={file.data.file.path}
          snapshotId={snapshotId}
          repo={snapshot.data.snapshot.repository}
          commitSha={snapshot.data.snapshot.commitSha}
          file={file.data.file}
          symbols={file.data.symbols}
          lines={lines}
          highlight={highlight}
        />
      ) : (
        <Notice>{file && !file.ok ? file.error : 'Select a file to view it.'}</Notice>
      )}
      {file?.ok && file.data.file.kind === 'CODE' && (
        <div className="md:col-start-2 xl:col-start-auto">
          <ReferencesPanel
            snapshotId={snapshotId}
            path={file.data.file.path}
            line={highlight?.start ?? null}
          />
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
      {children}
    </p>
  );
}

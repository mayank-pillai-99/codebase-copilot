import { snapshotResponseSchema } from '@codebase-copilot/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { RepoTabs } from '@/components/repo-tabs';
import { ScrollToTop } from '@/components/scroll-to-top';
import { ServerWaking } from '@/components/server-waking';
import { ChatDock, ChatDockProvider } from '@/components/workspace/chat-dock';
import { WorkspaceContent } from '@/components/workspace/content';
import { WorkspaceSidebar } from '@/components/workspace/sidebar';
import { WorkspaceTopBar } from '@/components/workspace/top-bar';
import { serverApi } from '@/lib/server-api';
import { getCurrentUser } from '@/lib/session';

export async function generateMetadata(
  props: LayoutProps<'/repos/[snapshotId]'>,
): Promise<Metadata> {
  const { snapshotId } = await props.params;
  const result = await serverApi(`/api/snapshots/${snapshotId}`, snapshotResponseSchema);
  const name = result.ok
    ? `${result.data.snapshot.repository.owner}/${result.data.snapshot.repository.name}`
    : 'Repository';
  return { title: `${name} · Codebase Copilot` };
}

/**
 * The repository workspace: a top bar, section sidebar, the section itself and a chat
 * panel that stays open across sections. On wider screens the frame fills the window and
 * each column scrolls on its own; on phones it is one scrolling page with section tabs.
 */
export default async function SnapshotLayout(props: LayoutProps<'/repos/[snapshotId]'>) {
  const { snapshotId } = await props.params;
  // Demo repositories are public, so a session is optional here; the API decides access.
  const [user, result] = await Promise.all([
    getCurrentUser(),
    serverApi(`/api/snapshots/${snapshotId}`, snapshotResponseSchema),
  ]);
  if (!result.ok && result.status === 404) {
    // Not visible anonymously: it may be the visitor's own repository once they log in.
    if (!user) redirect(`/login?next=${encodeURIComponent(`/repos/${snapshotId}`)}`);
    notFound();
  }
  const snapshot = result.ok ? result.data.snapshot : null;

  return (
    <ChatDockProvider snapshotId={snapshotId} ready={snapshot?.status === 'READY'}>
      <div className="flex min-h-dvh flex-col md:h-dvh md:min-h-0 md:overflow-hidden">
        <ScrollToTop />
        <WorkspaceTopBar snapshot={snapshot} email={user?.email ?? null} />
        {snapshot ? (
          <div className="flex min-h-0 flex-1">
            <WorkspaceSidebar snapshotId={snapshotId} />
            <main id="workspace-main" className="@container min-w-0 flex-1 md:overflow-y-auto">
              <div className="border-b border-zinc-200 px-2 md:hidden dark:border-zinc-800">
                <RepoTabs snapshotId={snapshotId} />
              </div>
              <WorkspaceContent snapshotId={snapshotId}>
                {props.children as ReactNode}
              </WorkspaceContent>
            </main>
            <ChatDock snapshotId={snapshotId} />
          </div>
        ) : (
          <main className="mx-auto w-full max-w-6xl px-4 py-8">
            {!result.ok && result.unreachable ? (
              <ServerWaking />
            ) : (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {result.ok ? null : result.error}
              </p>
            )}
          </main>
        )}
      </div>
    </ChatDockProvider>
  );
}

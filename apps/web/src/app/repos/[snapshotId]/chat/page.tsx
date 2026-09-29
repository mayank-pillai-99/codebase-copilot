import {
  chatSessionListResponseSchema,
  chatSessionResponseSchema,
  snapshotResponseSchema,
} from '@codebase-copilot/shared';
import { ChatPanel } from '@/components/chat-panel';
import { serverApi } from '@/lib/server-api';

export default async function ChatPage(props: PageProps<'/repos/[snapshotId]/chat'>) {
  const [{ snapshotId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const snapshot = await serverApi(`/api/snapshots/${snapshotId}`, snapshotResponseSchema);
  if (!snapshot.ok) return null;
  if (snapshot.data.snapshot.status !== 'READY') {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        Chat opens once indexing finishes.
      </p>
    );
  }

  const requested = typeof searchParams.session === 'string' ? searchParams.session : null;
  const [sessions, session] = await Promise.all([
    serverApi(`/api/snapshots/${snapshotId}/chat/sessions`, chatSessionListResponseSchema),
    requested
      ? serverApi(`/api/chat/sessions/${encodeURIComponent(requested)}`, chatSessionResponseSchema)
      : null,
  ]);
  // A session from another snapshot (or one that doesn't exist) starts a fresh conversation.
  const current =
    session?.ok && session.data.session.snapshotId === snapshotId ? session.data : null;

  return (
    <ChatPanel
      // Remount when switching conversations so streaming state never leaks between them.
      key={current?.session.id ?? 'new'}
      snapshotId={snapshotId}
      sessions={sessions.ok ? sessions.data.sessions : []}
      initialSessionId={current?.session.id ?? null}
      initialMessages={current?.messages ?? []}
    />
  );
}

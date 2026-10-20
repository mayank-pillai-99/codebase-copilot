'use client';

import {
  chatSessionListResponseSchema,
  chatSessionResponseSchema,
  type ChatMessageDto,
  type ChatSessionSummary,
} from '@codebase-copilot/shared';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { activeSection } from '@/lib/repo-sections';
import { useStoredValue, writeStored } from '@/lib/stored-value';
import { ChatPanel } from '../chat-panel';

const OPEN_KEY = 'chat-dock-open';
const sessionKey = (snapshotId: string) => `chat-dock-session:${snapshotId}`;

interface ChatDockState {
  /** Chat can be docked here: the repository is indexed and this isn't the full chat page. */
  available: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const ChatDockContext = createContext<ChatDockState>({
  available: false,
  open: false,
  setOpen: () => {},
});

export function useChatDock(): ChatDockState {
  return useContext(ChatDockContext);
}

/**
 * Whether the chat panel is open, shared by the top bar, the command palette and the
 * panel. It lives in the workspace layout, which stays mounted while the visitor moves
 * between sections, so an answer keeps streaming while they open its citations.
 */
export function ChatDockProvider({
  snapshotId,
  ready,
  children,
}: {
  snapshotId: string;
  ready: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const stored = useStoredValue('session', OPEN_KEY);
  const available = ready && activeSection(snapshotId, pathname) !== 'chat';
  const state: ChatDockState = {
    available,
    open: available && stored === '1',
    setOpen: (open) => writeStored('session', OPEN_KEY, open ? '1' : null),
  };
  return <ChatDockContext.Provider value={state}>{children}</ChatDockContext.Provider>;
}

/** The top bar's button that opens and closes the panel (wider screens only). */
export function ChatDockToggle() {
  const { available, open, setOpen } = useChatDock();
  if (!available) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-controls="chat-dock"
      className={`hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition md:inline-flex ${
        open
          ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200 dark:bg-brand-950 dark:text-brand-200 dark:ring-brand-800'
          : 'text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/60'
      }`}
    >
      <ChatIcon className="size-4" />
      Ask
    </button>
  );
}

interface Loaded {
  sessions: ChatSessionSummary[];
  sessionId: string | null;
  messages: ChatMessageDto[];
  /** Changes whenever the conversation is switched, to remount the panel. */
  key: string;
}

/** The docked chat panel on the right of the workspace. */
export function ChatDock({ snapshotId }: { snapshotId: string }) {
  const { open, setOpen } = useChatDock();
  const storedSession = useStoredValue('session', sessionKey(snapshotId));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);

  // Conversations load the first time the panel opens, so visitors who never open it
  // cost no requests.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      const list = chatSessionListResponseSchema.parse(
        await getJson(`/api/snapshots/${snapshotId}/chat/sessions`),
      );
      const current = storedSession ? await loadSession(snapshotId, storedSession) : null;
      if (cancelled) return;
      setLoaded({
        sessions: list.sessions,
        sessionId: current?.session.id ?? null,
        messages: current?.messages ?? [],
        key: current?.session.id ?? 'new',
      });
    })().catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [open, loaded, snapshotId, storedSession]);

  async function select(id: string | null) {
    writeStored('session', sessionKey(snapshotId), id);
    const current = id ? await loadSession(snapshotId, id).catch(() => null) : null;
    setLoaded((prev) => ({
      sessions: prev?.sessions ?? [],
      sessionId: current?.session.id ?? null,
      messages: current?.messages ?? [],
      key: current?.session.id ?? `new-${Date.now()}`,
    }));
  }

  if (!open) return null;
  return (
    <aside
      id="chat-dock"
      aria-label="Chat"
      className="hidden w-[26rem] shrink-0 animate-fade-in flex-col border-l border-zinc-200 bg-white md:flex dark:border-zinc-800 dark:bg-zinc-950"
    >
      {loaded ? (
        <ChatPanel
          key={loaded.key}
          variant="dock"
          snapshotId={snapshotId}
          sessions={loaded.sessions}
          initialSessionId={loaded.sessionId}
          initialMessages={loaded.messages}
          onSelectSession={(id) => void select(id)}
          onSessionCreated={(session) => {
            writeStored('session', sessionKey(snapshotId), session.id);
            setLoaded((prev) =>
              prev
                ? {
                    ...prev,
                    sessions: [session, ...prev.sessions],
                    sessionId: session.id,
                    // Same key: the panel that is streaming this answer stays mounted.
                  }
                : prev,
            );
          }}
          onClose={() => setOpen(false)}
        />
      ) : (
        <div className="flex flex-col gap-3 p-4" role="status" aria-label="Loading chat">
          {error ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Chat couldn&apos;t load. Close the panel and try again.
            </p>
          ) : (
            <>
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-3 w-4/5" />
              <div className="skeleton h-3 w-2/3" />
            </>
          )}
        </div>
      )}
    </aside>
  );
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** A saved conversation, or null if it's gone or belongs to another snapshot. */
async function loadSession(snapshotId: string, id: string) {
  const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const data = chatSessionResponseSchema.parse(await res.json());
  return data.session.snapshotId === snapshotId ? data : null;
}

export function ChatIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5h16v10H9l-5 4z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  );
}

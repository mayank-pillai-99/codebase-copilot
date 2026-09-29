'use client';

import { addRepositoryRequestSchema, addRepositoryResponseSchema } from '@codebase-copilot/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function AddRepositoryForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = addRepositoryRequestSchema.safeParse({
      url: new FormData(event.currentTarget).get('url'),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a GitHub repository URL');
      return;
    }

    setPending(true);
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const body: unknown = await res.json().catch(() => null);
      const result = addRepositoryResponseSchema.safeParse(body);
      if (res.ok && result.success) {
        router.push(`/repos/${result.data.snapshot.id}`);
        return;
      }
      setError(
        res.status === 429
          ? 'You have added a lot of repositories recently. Try again in a while.'
          : errorMessage(body),
      );
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <label htmlFor="url" className="text-sm font-medium">
        GitHub repository
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="url"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/owner/repo"
          aria-invalid={error ? true : undefined}
          aria-describedby="url-help"
          className="input min-w-0 flex-1 font-mono"
        />
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? 'Adding…' : 'Analyze repository'}
        </button>
      </div>
      {error ? (
        <p id="url-help" role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : (
        <p id="url-help" className="text-sm text-zinc-500 dark:text-zinc-400">
          Public TypeScript or JavaScript repositories, up to 2,000 source files. Add{' '}
          <code className="font-mono text-xs">/tree/branch</code> to pick a branch.
        </p>
      )}
    </form>
  );
}

function errorMessage(body: unknown): string {
  if (typeof body !== 'object' || body === null) return 'Something went wrong. Please try again.';
  if (
    'issues' in body &&
    Array.isArray(body.issues) &&
    typeof body.issues[0]?.message === 'string'
  ) {
    return body.issues[0].message;
  }
  if ('error' in body && typeof body.error === 'string') return body.error;
  return 'Something went wrong. Please try again.';
}

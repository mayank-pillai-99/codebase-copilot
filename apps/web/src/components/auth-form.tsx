'use client';

import { loginRequestSchema, registerRequestSchema } from '@codebase-copilot/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { LogoMark } from './logo';

type Mode = 'login' | 'register';
type FieldErrors = Partial<Record<'email' | 'password', string>>;

const COPY = {
  login: {
    title: 'Log in',
    submit: 'Log in',
    pending: 'Logging in…',
    switchPrompt: 'New here?',
    switchLabel: 'Create an account',
    switchHref: '/register',
  },
  register: {
    title: 'Create your account',
    submit: 'Create account',
    pending: 'Creating account…',
    switchPrompt: 'Already have an account?',
    switchLabel: 'Log in',
    switchHref: '/login',
  },
} as const;

export function AuthForm({ mode, next }: { mode: Mode; next: string }) {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const copy = COPY[mode];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const data = new FormData(event.currentTarget);
    const schema = mode === 'login' ? loginRequestSchema : registerRequestSchema;
    const parsed = schema.safeParse({ email: data.get('email'), password: data.get('password') });
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error.issues));
      return;
    }
    setFieldErrors({});
    setPending(true);

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      const body: { error?: string; issues?: Issue[] } = await res.json().catch(() => ({}));
      if (res.status === 400 && body.issues) setFieldErrors(toFieldErrors(body.issues));
      else if (res.status === 429) setFormError('Too many attempts. Wait a minute and try again.');
      else setFormError(body.error ?? 'Something went wrong. Please try again.');
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    }
    setPending(false);
  }

  return (
    <div className="card mx-auto w-full max-w-sm animate-fade-up p-6 shadow-xl shadow-zinc-900/5 sm:p-8 dark:shadow-black/30">
      <LogoMark className="size-8" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">{copy.title}</h1>

      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <Field
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={fieldErrors.email}
        />
        <Field
          name="password"
          label="Password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          hint={mode === 'register' ? 'At least 8 characters.' : undefined}
          error={fieldErrors.password}
        />

        {formError && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
          >
            {formError}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn-primary py-2.5">
          {pending && (
            <span
              aria-hidden
              className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          )}
          {pending ? copy.pending : copy.submit}
        </button>
      </form>

      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        {copy.switchPrompt}{' '}
        <Link href={`${copy.switchHref}?next=${encodeURIComponent(next)}`} className="link-accent">
          {copy.switchLabel}
        </Link>
      </p>
    </div>
  );
}

type Issue = { path: PropertyKey[]; message: string };

function toFieldErrors(issues: Issue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const { path, message } of issues) {
    const field = path[0];
    if ((field === 'email' || field === 'password') && !errors[field]) errors[field] = message;
  }
  return errors;
}

function Field(props: {
  name: 'email' | 'password';
  label: string;
  type: string;
  autoComplete: string;
  hint?: string | undefined;
  error?: string | undefined;
}) {
  const { name, label, type, autoComplete, hint, error } = props;
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="input"
      />
      {error ? (
        <p id={`${name}-error`} className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${name}-hint`} className="text-sm text-zinc-500 dark:text-zinc-400">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

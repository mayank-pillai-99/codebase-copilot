import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { safeNextPath } from '@/lib/redirect';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Create account · Codebase Copilot' };

export default async function RegisterPage(props: PageProps<'/register'>) {
  const next = safeNextPath((await props.searchParams).next);
  if (await getCurrentUser()) redirect(next);

  return (
    <main className="dot-grid flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 py-16 sm:py-24">
      <AuthForm mode="register" next={next} />
    </main>
  );
}
